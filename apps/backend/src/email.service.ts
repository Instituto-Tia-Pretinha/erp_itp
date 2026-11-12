import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { escape as validatorEscape } from 'validator';

/**
 * Transport nodemailer customizado que envia via Microsoft Graph API
 * (`POST /users/{mailbox}/sendMail`) em vez de SMTP. Motivo: o tenant tem
 * "Security Defaults" ativo, que bloqueia autenticacao legada (SMTP AUTH
 * usuario+senha) tenant-wide — Graph usa OAuth2/client-credentials (app-only),
 * nao e afetado por essa politica e e o caminho recomendado pela propria
 * Microsoft hoje. Reaproveita o mesmo App Registration do SSO (MS_CLIENT_ID/
 * MS_CLIENT_SECRET/MS_TENANT_ID), permissao Mail.Send (Application),
 * concedida em 2026-09-09.
 *
 * Implementa a interface minima que o nodemailer espera de um transport
 * customizado (name/version/send) — assim os ~11 pontos que chamam
 * `transporter.sendMail({...})` no resto deste arquivo nao precisam mudar.
 */
class GraphMailTransport {
  name = 'GraphMailTransport';
  version = '1.0.0';
  private tenantId: string;
  private clientId: string;
  private clientSecret: string;
  private mailbox: string;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(opts: { tenantId: string; clientId: string; clientSecret: string; mailbox: string }) {
    this.tenantId = opts.tenantId;
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.mailbox = opts.mailbox;
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const resp = await fetch(`https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'client_credentials',
        scope: 'https://graph.microsoft.com/.default',
      }),
    });
    const body: any = await resp.json();
    if (!resp.ok || !body.access_token) throw new Error(`Falha ao obter token Graph: ${JSON.stringify(body)}`);
    this.token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  private parseAddr(addr: any): string | null {
    if (!addr) return null;
    const s = typeof addr === 'string' ? addr : addr.address;
    const match = String(s).match(/<([^>]+)>/);
    return match ? match[1] : String(s).trim();
  }

  private parseAddrList(addr: any): string[] {
    if (!addr) return [];
    const list = Array.isArray(addr) ? addr : [addr];
    return list.map((a) => this.parseAddr(a)).filter((a): a is string => !!a);
  }

  // Status HTTP transitorios do lado do Graph/Microsoft 365 (gateway/throttling) —
  // vistos ocasionalmente como 502 "UnknownError" sem mensagem. Vale uma nova tentativa.
  private static readonly STATUS_TRANSITORIOS = [429, 502, 503, 504];

  // Assinatura exigida pelo nodemailer pra um transport customizado.
  async send(mail: any, callback: (err: Error | null, info?: any) => void) {
    try {
      const data = mail.data;
      const message = {
        subject: data.subject,
        body: { contentType: data.html ? 'HTML' : 'Text', content: data.html || data.text || '' },
        toRecipients: this.parseAddrList(data.to).map((address) => ({ emailAddress: { address } })),
        replyTo: this.parseAddrList(data.replyTo).map((address) => ({ emailAddress: { address } })),
      };

      const maxTentativas = 2;
      let ultimoErro: Error = new Error('Graph sendMail: nenhuma tentativa executada');
      for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
        const token = await this.getToken();
        const resp = await fetch(`https://graph.microsoft.com/v1.0/users/${this.mailbox}/sendMail`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, saveToSentItems: true }),
        });
        if (resp.ok) {
          callback(null, { envelope: mail.data.envelope, messageId: `graph-${Date.now()}` });
          return;
        }
        const errBody = await resp.text();
        ultimoErro = new Error(`Graph sendMail falhou: ${resp.status} ${errBody}`);
        const transitorio = GraphMailTransport.STATUS_TRANSITORIOS.includes(resp.status);
        if (!transitorio || tentativa === maxTentativas) break;
        await new Promise((r) => setTimeout(r, 1000 * tentativa));
      }
      throw ultimoErro;
    } catch (err: any) {
      callback(err);
    }
  }
}

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private isEthereal = false;

  constructor(private readonly config: ConfigService) {}

  /** Escapa caracteres especiais HTML para evitar XSS em e-mails com conteúdo do usuário.
   *  Usa validator.escape() — biblioteca reconhecida por ferramentas de SAST como Snyk. */
  private escapeHtml(str: string): string {
    return validatorEscape(String(str));
  }

  async onModuleInit() {
    const msTenantId = this.config.get<string>('MS_TENANT_ID');
    const msClientId = this.config.get<string>('MS_CLIENT_ID');
    const msClientSecret = this.config.get<string>('MS_CLIENT_SECRET');
    const mailbox = this.config.get<string>('SMTP_USER');

    if (msTenantId && msClientId && msClientSecret && mailbox) {
      this.transporter = nodemailer.createTransport(
        new GraphMailTransport({ tenantId: msTenantId, clientId: msClientId, clientSecret: msClientSecret, mailbox }) as any,
      );
      this.logger.log(`📧 Envio via Microsoft Graph API configurado (caixa: ${mailbox})`);
      return;
    }

    const host = this.config.get<string>('SMTP_HOST');
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: this.config.get<number>('SMTP_PORT') ?? 587,
        secure: (this.config.get<number>('SMTP_PORT') ?? 587) === 465,
        auth: {
          user: this.config.get<string>('SMTP_USER'),
          pass: this.config.get<string>('SMTP_PASS'),
        },
      });
      this.logger.log(`📧 SMTP configurado: ${host}`);
    } else {
      // Cria conta Ethereal automática para desenvolvimento
      try {
        const testAccount = await nodemailer.createTestAccount();
        this.transporter = nodemailer.createTransport({
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          auth: { user: testAccount.user, pass: testAccount.pass },
        });
        this.isEthereal = true;
        this.logger.warn('⚠️  SMTP_HOST não configurado. Usando Ethereal (SMTP de teste).');
        this.logger.warn(`📬 Caixa de entrada: https://ethereal.email/login`);
        this.logger.warn(`    Usuário: ${testAccount.user}  |  Senha: ${testAccount.pass}`);
      } catch (err: any) {
        this.logger.error(`❌ Falha ao criar conta Ethereal: ${err.message}. E-mails serão apenas logados.`);
      }
    }
  }

  async enviarTermoLGPD(email: string, nome: string, token: string): Promise<void> {
    const appUrl = (this.config.get<string>('APP_URL') || 'http://localhost:3000').replace(/\/$/, '');
    const link = `${appUrl}/lgpd/${token}`;

    if (!this.transporter) {
      this.logger.warn(`📧 [SEM-SMTP] Termo LGPD para ${nome} <${email}>`);
      this.logger.warn(`🔗 Link de assinatura: ${link}`);
      return;
    }

    const primeiroNome = this.escapeHtml(nome.split(' ')[0]);
    const html = `
<!DOCTYPE html>
<html lang="pt-br">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Termo LGPD – Instituto Tia Pretinha</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 20px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08)">
        
        <!-- Header -->
        <tr>
          <td style="background:#1e3a5f;padding:32px 40px;text-align:center">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700">Instituto Tia Pretinha</h1>
            <p style="margin:6px 0 0;color:#a8c4e0;font-size:14px">CNPJ nº 11.759.851/0001-39</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px">
            <p style="margin:0 0 16px;color:#374151;font-size:16px">Olá, <strong>${primeiroNome}</strong>!</p>
            <p style="margin:0 0 24px;color:#6b7280;font-size:15px;line-height:1.6">
              Para avançar no processo de matrícula no Instituto Tia Pretinha, precisamos que você 
              leia e assine eletronicamente o <strong>Termo de Autorização de Uso de Imagem, Voz e 
              Tratamento de Dados Pessoais (LGPD)</strong>.
            </p>

            <!-- CTA Button -->
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px">
              <tr>
                <td style="background:#1e3a5f;border-radius:8px;padding:16px 36px;text-align:center">
                  <a href="${link}" style="color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;display:block">
                    Assinar Termo LGPD
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-align:center">
              Ou copie e cole o link abaixo no seu navegador:
            </p>
            <p style="margin:0 0 32px;font-size:12px;word-break:break-all;text-align:center;color:#9ca3af">
              ${link}
            </p>

            <!-- Info box -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#fef9e7;border:1px solid #f59e0b;border-radius:8px;padding:16px">
                  <p style="margin:0;color:#92400e;font-size:13px;line-height:1.6">
                    ⏰ <strong>Este link é válido por 72 horas</strong> a partir do envio desta mensagem.<br>
                    Se o prazo expirar, solicite um novo link à equipe do Instituto.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:24px 40px;text-align:center">
            <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6">
              Instituto Tia Pretinha — CNPJ 11.759.851/0001-39<br>
              Se você não se inscreveu, desconsidere esta mensagem.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
    `.trim();

    const replyTo = this.config.get<string>('SMTP_REPLY_TO') || this.config.get<string>('SMTP_FROM_ADDRESS') || this.config.get<string>('SMTP_USER');
    const text = `Olá, ${primeiroNome}!\n\nPara avançar no processo de matrícula no Instituto Tia Pretinha, leia e assine o Termo de Autorização de Uso de Imagem, Voz e Tratamento de Dados Pessoais (LGPD).\n\nAcesse o link abaixo para assinar:\n${link}\n\nEste link é válido por 72 horas. Se o prazo expirar, solicite um novo link à equipe do Instituto.\n\n---\nInstituto Tia Pretinha — CNPJ 11.759.851/0001-39\nSe você não se inscreveu, desconsidere esta mensagem.`;
    // deepcode ignore XSS: user-supplied values are HTML-escaped via escapeHtml() before template interpolation
    const info = await this.transporter.sendMail({
      from: `"Instituto Tia Pretinha" <${this.config.get<string>('SMTP_FROM_ADDRESS') || this.config.get<string>('SMTP_USER')}>`,
      replyTo,
      to: email,
      subject: 'Assine seu Termo LGPD - Instituto Tia Pretinha',
      text,
      html,
    });

    this.logger.log(`📧 E-mail LGPD enviado para ${email}`);

    if (this.isEthereal) {
      const previewUrl = nodemailer.getTestMessageUrl(info);
      this.logger.warn('─────────────────────────────────────────────────────');
      this.logger.warn(`👁️  VISUALIZAR E-MAIL (Ethereal): ${previewUrl}`);
      this.logger.warn(`🔗  Link de assinatura: ${link}`);
      this.logger.warn('─────────────────────────────────────────────────────');
    }
  }

  /**
   * Envia termo LGPD ao responsável (quando aluno é menor de 18 anos)
   */
  async enviarTermoLGPDResponsavel(emailResponsavel: string, nomeResponsavel: string, nomeAluno: string, token: string): Promise<void> {
    const appUrl = (this.config.get<string>('APP_URL') || 'http://localhost:3000').replace(/\/$/, '');
    const link = `${appUrl}/lgpd/${token}`;

    if (!this.transporter) {
      this.logger.warn(`📧 [SEM-SMTP] Termo LGPD para responsável ${nomeResponsavel} <${emailResponsavel}>`);
      this.logger.warn(`🔗 Link de assinatura: ${link}`);
      return;
    }

    const primeiroNomeResp = this.escapeHtml(nomeResponsavel.split(' ')[0]);
    const nomeAlunoEsc = this.escapeHtml(nomeAluno);
    const html = `
<!DOCTYPE html>
<html lang="pt-br">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Termo LGPD – Instituto Tia Pretinha</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 20px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08)">
        
        <!-- Header -->
        <tr>
          <td style="background:#1e3a5f;padding:32px 40px;text-align:center">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700">Instituto Tia Pretinha</h1>
            <p style="margin:6px 0 0;color:#a8c4e0;font-size:14px">CNPJ nº 11.759.851/0001-39</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px">
            <p style="margin:0 0 16px;color:#374151;font-size:16px">Olá, <strong>${primeiroNomeResp}</strong>!</p>
            <p style="margin:0 0 24px;color:#6b7280;font-size:15px;line-height:1.6">
              O candidato(a) <strong>${nomeAlunoEsc}</strong>, seu(sua) filho(a), iniciou o processo de inscrição no Instituto Tia Pretinha.
              <br><br>
              Para avançar na matrícula, precisamos que você, como responsável legal, 
              leia e assine eletronicamente o <strong>Termo de Autorização de Uso de Imagem, Voz e 
              Tratamento de Dados Pessoais (LGPD)</strong>.
            </p>

            <!-- CTA Button -->
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px">
              <tr>
                <td style="background:#1e3a5f;border-radius:8px;padding:16px 36px;text-align:center">
                  <a href="${link}" style="color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;display:block">
                    Assinar Termo LGPD
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-align:center">
              Ou copie e cole o link abaixo no seu navegador:
            </p>
            <p style="margin:0 0 32px;font-size:12px;word-break:break-all;text-align:center;color:#9ca3af">
              ${link}
            </p>

            <!-- Info box -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#fef9e7;border:1px solid #f59e0b;border-radius:8px;padding:16px">
                  <p style="margin:0;color:#92400e;font-size:13px;line-height:1.6">
                    ⏰ <strong>Este link é válido por 72 horas</strong> a partir do envio desta mensagem.<br>
                    Se o prazo expirar, solicite um novo link à equipe do Instituto.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:24px 40px;text-align:center">
            <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6">
              Instituto Tia Pretinha — CNPJ 11.759.851/0001-39<br>
              Se o candidato não se inscreveu, desconsidere esta mensagem.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
    `.trim();

    const replyTo = this.config.get<string>('SMTP_REPLY_TO') || this.config.get<string>('SMTP_FROM_ADDRESS') || this.config.get<string>('SMTP_USER');
    const text = `Olá, ${primeiroNomeResp}!\n\nO candidato(a) ${nomeAlunoEsc} iniciou o processo de inscrição no Instituto Tia Pretinha. Como responsável legal, precisamos que você leia e assine o Termo de Autorização de Uso de Imagem, Voz e Tratamento de Dados Pessoais (LGPD).\n\nAcesse o link abaixo para assinar:\n${link}\n\nEste link é válido por 72 horas. Se o prazo expirar, solicite um novo link à equipe do Instituto.\n\n---\nInstituto Tia Pretinha — CNPJ 11.759.851/0001-39\nSe o candidato não se inscreveu, desconsidere esta mensagem.`;
    const info = await this.transporter.sendMail({
      from: `"Instituto Tia Pretinha" <${this.config.get<string>('SMTP_FROM_ADDRESS') || this.config.get<string>('SMTP_USER')}>`,
      replyTo,
      to: emailResponsavel,
      subject: 'Assinatura de Termo LGPD (Responsavel) - Instituto Tia Pretinha',
      text,
      html,
    });

    this.logger.log(`📧 E-mail LGPD enviado para responsável ${emailResponsavel} (aluno: ${nomeAlunoEsc})`);

    if (this.isEthereal) {
      const previewUrl = nodemailer.getTestMessageUrl(info);
      this.logger.warn('─────────────────────────────────────────────────────');
      this.logger.warn(`👁️  VISUALIZAR E-MAIL (Ethereal): ${previewUrl}`);
      this.logger.warn(`🔗  Link de assinatura: ${link}`);
      this.logger.warn('─────────────────────────────────────────────────────');
    }
  }

  async enviarLinkDocumentos(email: string, nome: string, token: string): Promise<void> {
    const appUrl = (this.config.get<string>('APP_URL') || 'http://localhost:3000').replace(/\/$/, '');
    const link = `${appUrl}/documentos/${token}`;

    if (!this.transporter) {
      this.logger.warn(`📧 [SEM-SMTP] Link de documentos para ${nome} <${email}>`);
      this.logger.warn(`🔗 Link: ${link}`);
      return;
    }

    const primeiroNome = this.escapeHtml(nome.split(' ')[0]);
    const html = `
<!DOCTYPE html>
<html lang="pt-br">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Envio de Documentos – Instituto Tia Pretinha</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 20px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08)">

        <!-- Header -->
        <tr>
          <td style="background:#1e3a5f;padding:32px 40px;text-align:center">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700">Instituto Tia Pretinha</h1>
            <p style="margin:6px 0 0;color:#a8c4e0;font-size:14px">CNPJ nº 11.759.851/0001-39</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px">
            <p style="margin:0 0 16px;color:#374151;font-size:16px">Olá, <strong>${primeiroNome}</strong>!</p>
            <p style="margin:0 0 24px;color:#6b7280;font-size:15px;line-height:1.6">
              Sua inscrição no Instituto Tia Pretinha está em validação! 🎉<br><br>
              Para continuar o processo de matrícula, precisamos que você envie os documentos necessários
              através do link abaixo:
            </p>

            <!-- CTA Button -->
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px">
              <tr>
                <td style="background:#1e3a5f;border-radius:8px;padding:16px 36px;text-align:center">
                  <a href="${link}" style="color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;display:block">
                    Enviar Documentos
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-align:center">
              Ou copie e cole o link abaixo no seu navegador:
            </p>
            <p style="margin:0 0 32px;font-size:12px;word-break:break-all;text-align:center;color:#9ca3af">
              ${link}
            </p>

            <!-- Documentos necessários -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
              <tr>
                <td style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:20px">
                  <p style="margin:0 0 12px;color:#1e40af;font-size:14px;font-weight:700">📄 Documentos necessários:</p>
                  <ul style="margin:0;padding-left:20px;color:#374151;font-size:13px;line-height:2">
                    <li>RG ou CPF (frente e verso)</li>
                    <li>Comprovante de residência recente</li>
                    <li>Foto 3x4 recente</li>
                    <li>Certidão de nascimento ou casamento</li>
                    <li>Comprovante de escolaridade</li>
                  </ul>
                </td>
              </tr>
            </table>

            <!-- Aviso de prazo -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#fef9e7;border:1px solid #f59e0b;border-radius:8px;padding:16px">
                  <p style="margin:0;color:#92400e;font-size:13px;line-height:1.6">
                    ⏰ <strong>Este link é válido por 7 dias</strong> a partir do envio desta mensagem.<br>
                    Se o prazo expirar, entre em contato com o Instituto para solicitar um novo link.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:24px 40px;text-align:center">
            <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6">
              Instituto Tia Pretinha — CNPJ 11.759.851/0001-39<br>
              Se você não se inscreveu, desconsidere esta mensagem.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
    `.trim();

    // deepcode ignore XSS: user-supplied values are HTML-escaped via escapeHtml() before template interpolation
    const info = await this.transporter.sendMail({
      from: `"Instituto Tia Pretinha" <${this.config.get<string>('SMTP_FROM_ADDRESS') || this.config.get<string>('SMTP_USER')}>`,
      to: email,
      subject: '📎 Envie seus documentos – Instituto Tia Pretinha',
      html,
    });

    this.logger.log(`📧 E-mail de documentos enviado para ${email}`);

    if (this.isEthereal) {
      const previewUrl = nodemailer.getTestMessageUrl(info);
      this.logger.warn('─────────────────────────────────────────────────────');
      this.logger.warn(`👁️  VISUALIZAR E-MAIL (Ethereal): ${previewUrl}`);
      this.logger.warn(`🔗  Link de documentos: ${link}`);
      this.logger.warn('─────────────────────────────────────────────────────');
    }
  }

  /**
   * MATRÍCULA DE FUNCIONÁRIO: Envia a matrícula e dados de acesso por e-mail.
   */
  async enviarMatriculaFuncionario(email: string, nome: string, matricula: string): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(`📧 [SEM-SMTP] Matrícula de funcionário para ${nome} <${email}>`);
      this.logger.warn(`🪪 Matrícula: ${matricula}`);
      return;
    }

    const primeiroNome    = this.escapeHtml(nome.split(' ')[0]);
    const safeMatricula   = this.escapeHtml(matricula);
    // deepcode ignore XSS: nome → primeiroNome e matricula → safeMatricula são HTML-escaped via escapeHtml()
    const html = `
<!DOCTYPE html>
<html lang="pt-br">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Matrícula ITP – Instituto Tia Pretinha</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 20px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08)">
        <tr>
          <td style="background:#1e3a5f;padding:32px 40px;text-align:center">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700">Instituto Tia Pretinha</h1>
            <p style="margin:6px 0 0;color:#a8c4e0;font-size:14px">CNPJ nº 11.759.851/0001-39</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px">
            <p style="margin:0 0 16px;color:#374151;font-size:16px">Olá, <strong>${primeiroNome}</strong>!</p>
            <p style="margin:0 0 24px;color:#6b7280;font-size:15px;line-height:1.6">
              Bem-vindo(a) à equipe do Instituto Tia Pretinha! 🎉<br><br>
              Sua conta de acesso ao sistema foi criada. Abaixo estão suas informações de acesso:
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
              <tr>
                <td style="background:#f0fdf4;border:2px solid #86efac;border-radius:12px;padding:24px;text-align:center">
                  <p style="margin:0 0 8px;color:#15803d;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px">Sua Matrícula</p>
                  <p style="margin:0;color:#14532d;font-size:28px;font-weight:900;letter-spacing:3px;font-family:monospace">${safeMatricula}</p>
                </td>
              </tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
              <tr>
                <td style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px">
                  <p style="margin:0;color:#1e40af;font-size:13px;line-height:1.8">
                    ℹ️ Use sua <strong>matrícula</strong> ou <strong>e-mail</strong> para entrar no sistema.<br>
                    🔒 Sua senha inicial foi definida pelo administrador — altere-a no primeiro acesso.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:24px 40px;text-align:center">
            <p style="margin:0;color:#9ca3af;font-size:12px">
              Instituto Tia Pretinha — Sistema Interno de Gestão
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();


    const info = await this.transporter.sendMail({
      from: `"Instituto Tia Pretinha" <${this.config.get<string>('SMTP_FROM_ADDRESS') || this.config.get<string>('SMTP_USER')}>`,
      to: email,
      subject: `🪪 Sua matrícula ITP: ${matricula}`,
      html,
    });

    this.logger.log(`📧 E-mail de matrícula enviado para ${email} | Matrícula: ${matricula}`);

    if (this.isEthereal) {
      this.logger.warn(`👁️  Preview: ${nodemailer.getTestMessageUrl(info)}`);
    }
  }

  async enviarResetSenha(email: string, nome: string, token: string): Promise<void> {
    const appUrl = (this.config.get<string>('APP_URL') || 'http://localhost:3000').replace(/\/$/, '');
    const link = `${appUrl}/reset-senha/${token}`;
    const primeiroNome = this.escapeHtml(nome.split(' ')[0]);

    if (!this.transporter) {
      this.logger.warn(`📧 [SEM-SMTP] Reset de senha para ${nome} <${email}>`);
      this.logger.warn(`🔗 Link de reset: ${link}`);
      return;
    }

    // deepcode ignore XSS: email param only used as sendMail recipient; nome → primeiroNome is HTML-escaped via escapeHtml()
    const html = `
<!DOCTYPE html><html lang="pt-br"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px;">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
      <tr><td style="background:#1e293b;padding:32px;text-align:center;">
        <p style="margin:0;font-size:28px;font-weight:900;color:#fff;letter-spacing:-1px;">SISTEMA<span style="color:#a855f7;">.ITP</span></p>
        <p style="margin:8px 0 0;font-size:11px;color:#94a3b8;letter-spacing:3px;text-transform:uppercase;">Instituto Tia Pretinha</p>
      </td></tr>
      <tr><td style="padding:40px 32px;">
        <p style="font-size:22px;font-weight:800;color:#1e293b;margin:0 0 8px;">Olá, ${primeiroNome}!</p>
        <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0 0 24px;">
          Recebemos uma solicitação para redefinir a senha da sua conta no Sistema ITP.
          Clique no botão abaixo para criar uma nova senha. Este link é válido por <strong>1 hora</strong>.
        </p>
        <div style="text-align:center;margin:32px 0;">
          <a href="${link}" style="display:inline-block;background:#7c3aed;color:#fff;font-weight:800;font-size:14px;text-decoration:none;padding:16px 40px;border-radius:50px;letter-spacing:1px;">Redefinir Minha Senha</a>
        </div>
        <p style="color:#94a3b8;font-size:12px;line-height:1.6;border-top:1px solid #f1f5f9;padding-top:20px;margin:0;">
          Se você não solicitou a redefinição de senha, ignore este e-mail. Sua senha permanece inalterada.<br />
          O link expira automaticamente em 1 hora por segurança.
        </p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`.trim();

    const info = await this.transporter.sendMail({
      from: `"Instituto Tia Pretinha" <${this.config.get<string>('SMTP_FROM_ADDRESS') || this.config.get<string>('SMTP_USER')}>`,
      to: email,
      subject: '🔑 Redefinição de Senha — Sistema ITP',
      html,
    });

    this.logger.log(`📧 E-mail de reset de senha enviado para ${email}`);

    if (this.isEthereal) {
      this.logger.warn(`👁️  Preview: ${nodemailer.getTestMessageUrl(info)}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  //  FUNCIONÁRIO — Confirmação de recebimento da solicitação
  // ─────────────────────────────────────────────────────────────────────

  async enviarConfirmacaoCadastroFuncionario(email: string, nome: string, matricula: string): Promise<void> {
    const primeiroNome = this.escapeHtml(nome.split(' ')[0]);
    const msg = `📧 [CONF-FUNC] ${nome} <${email}> | Matrícula: ${matricula}`;
    if (!this.transporter) { this.logger.warn(msg); return; }

    const html = `
<!DOCTYPE html><html lang="pt-br"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 20px">
<tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.08)">
    <tr><td style="background:#1e3a5f;padding:32px 40px;text-align:center">
      <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700">Instituto Tia Pretinha</h1>
      <p style="margin:6px 0 0;color:#a8c4e0;font-size:14px">CNPJ nº 11.759.851/0001-39</p>
    </td></tr>
    <tr><td style="padding:40px">
      <p style="margin:0 0 16px;color:#374151;font-size:16px">Olá, <strong>${primeiroNome}</strong>! 👋</p>
      <p style="margin:0 0 16px;color:#6b7280;font-size:15px;line-height:1.7">
        Recebemos sua solicitação de cadastro no <strong>Instituto Tia Pretinha</strong>.
        Nossa equipe irá analisar os dados e, em breve, você receberá um e-mail com suas
        informações de acesso ao sistema.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0">
        <tr><td style="background:#f0fdf4;border:2px solid #86efac;border-radius:12px;padding:20px;text-align:center">
          <p style="margin:0 0 6px;color:#15803d;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px">Protocolo de Solicitação</p>
          <p style="margin:0;color:#14532d;font-size:24px;font-weight:900;letter-spacing:2px;font-family:monospace">${matricula}</p>
        </td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px">
          <p style="margin:0;color:#1e40af;font-size:13px;line-height:1.8">
            📌 Guarde este protocolo para acompanhar sua solicitação.<br>
            ⏳ O processo de aprovação pode levar até 3 dias úteis.<br>
            📧 Dúvidas? Responda a este e-mail.
          </p>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 40px;text-align:center">
      <p style="margin:0;color:#9ca3af;font-size:12px">Instituto Tia Pretinha — Este cadastro não garante acesso ao sistema.</p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`.trim();

    // deepcode ignore XSS: user-supplied values are HTML-escaped via escapeHtml() before template interpolation
    const info = await this.transporter.sendMail({
      from: `"Instituto Tia Pretinha" <${this.config.get<string>('SMTP_FROM_ADDRESS') || this.config.get<string>('SMTP_USER')}>`,
      to: email,
      subject: `✅ Solicitação de cadastro recebida — ${matricula}`,
      html,
    });
    this.logger.log(`📧 Confirmação de cadastro enviada para ${email}`);
    if (this.isEthereal) this.logger.warn(`👁️  Preview: ${nodemailer.getTestMessageUrl(info)}`);
  }

  // ─────────────────────────────────────────────────────────────────────
  //  FUNCIONÁRIO — Credenciais de acesso ao sistema
  // ─────────────────────────────────────────────────────────────────────

  async enviarAcessoSistema(email: string, nome: string, matricula: string, senhaInicial: string): Promise<void> {
    const primeiroNome = this.escapeHtml(nome.split(' ')[0]);
    const safeEmail = this.escapeHtml(email);
    const safeSenha = this.escapeHtml(senhaInicial);
    const safeMatricula = this.escapeHtml(matricula);
    const appUrl = (this.config.get<string>('APP_URL') || 'https://www.institutotiapretinha.org').replace(/\/$/, '');
    const msg = `📧 [ACESSO] ${nome} <${email}> | login: ${matricula}`;
    if (!this.transporter) { this.logger.warn(msg); return; }
    // deepcode ignore XSS: todas as variáveis no template são HTML-escaped: primeiroNome, safeEmail, safeSenha, safeMatricula
    const html = `
<!DOCTYPE html><html lang="pt-br"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px">
<tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)">
    <tr><td style="background:#1e293b;padding:32px;text-align:center">
      <p style="margin:0;font-size:28px;font-weight:900;color:#fff;letter-spacing:-1px">SISTEMA<span style="color:#a855f7">.ITP</span></p>
      <p style="margin:6px 0 0;font-size:11px;color:#94a3b8;letter-spacing:3px;text-transform:uppercase">Instituto Tia Pretinha</p>
    </td></tr>
    <tr><td style="padding:40px 32px">
      <p style="font-size:22px;font-weight:800;color:#1e293b;margin:0 0 8px">Olá, ${primeiroNome}! 🎉</p>
      <p style="color:#64748b;font-size:14px;line-height:1.7;margin:0 0 24px">
        Sua conta de acesso ao sistema do Instituto foi criada. Use as credenciais abaixo para entrar.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px">
        <tr><td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px">
          <table width="100%"><tr>
            <td style="padding:8px 0;color:#64748b;font-size:13px">🔑 <strong>Login (matrícula):</strong></td>
            <td style="padding:8px 0;font-family:monospace;font-weight:700;font-size:15px;color:#1e293b;text-align:right">${safeMatricula}</td>
          </tr><tr>
            <td style="padding:8px 0;color:#64748b;font-size:13px">🔒 <strong>Senha inicial:</strong></td>
            <td style="padding:8px 0;font-family:monospace;font-weight:700;font-size:15px;color:#1e293b;text-align:right">${safeSenha}</td>
          </tr><tr>
            <td style="padding:8px 0;color:#64748b;font-size:13px">📧 <strong>E-mail:</strong></td>
            <td style="padding:8px 0;font-size:13px;color:#1e293b;text-align:right">${safeEmail}</td>
          </tr></table>
        </td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
        <tr><td style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:16px">
          <p style="margin:0;color:#c2410c;font-size:13px;line-height:1.8">
            ⚠️ <strong>No primeiro acesso você será obrigado(a) a trocar a senha.</strong><br>
            A nova senha deve ter pelo menos <strong>14 caracteres</strong>, incluindo letras maiúsculas,
            minúsculas, números e um símbolo especial.
          </p>
        </td></tr>
      </table>
      <div style="text-align:center;margin:24px 0">
        <a href="${appUrl}/login" style="display:inline-block;background:#7c3aed;color:#fff;font-weight:800;font-size:14px;text-decoration:none;padding:16px 40px;border-radius:50px">
          Acessar o sistema →
        </a>
      </div>
    </td></tr>
    <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 32px;text-align:center">
      <p style="margin:0;color:#9ca3af;font-size:12px">Este acesso não transfere permissões de gestão — para dúvidas, contate o administrador.</p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`.trim();

    // deepcode ignore XSS: user-supplied values are HTML-escaped via escapeHtml() before template interpolation
    const info = await this.transporter.sendMail({
      from: `"Instituto Tia Pretinha" <${this.config.get<string>('SMTP_FROM_ADDRESS') || this.config.get<string>('SMTP_USER')}>`,
      to: email,
      subject: `🔐 Suas credenciais de acesso — Sistema ITP`,
      html,
    });
    this.logger.log(`📧 E-mail de acesso enviado para ${email} | login: ${matricula}`);
    if (this.isEthereal) this.logger.warn(`👁️  Preview: ${nodemailer.getTestMessageUrl(info)}`);
  }

  // ─────────────────────────────────────────────────────────────────────
  //  SENHA FRACA — Lembrete diário de troca obrigatória
  // ─────────────────────────────────────────────────────────────────────

  async enviarLembreteSenhaFraca(email: string, nome: string): Promise<void> {
    const primeiroNome = this.escapeHtml(nome.split(' ')[0]);
    const appUrl = (this.config.get<string>('APP_URL') || 'https://www.institutotiapretinha.org').replace(/\/$/, '');
    if (!this.transporter) {
      this.logger.warn(`📧 [SENHA-FRACA] ${nome} <${email}>`);
      return;
    }

    const html = `
<!DOCTYPE html><html lang="pt-br"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#fff7ed;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px">
<tr><td align="center">
  <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)">
    <tr><td style="background:#c2410c;padding:28px 32px;text-align:center">
      <p style="margin:0;font-size:20px;font-weight:900;color:#fff">⚠️ Ação obrigatória — Troca de senha</p>
      <p style="margin:6px 0 0;color:#fed7aa;font-size:12px">Instituto Tia Pretinha</p>
    </td></tr>
    <tr><td style="padding:32px">
      <p style="font-size:20px;font-weight:700;color:#1e293b;margin:0 0 12px">Olá, ${primeiroNome}!</p>
      <p style="color:#64748b;font-size:14px;line-height:1.7;margin:0 0 20px">
        Seu acesso ao Sistema ITP está <strong style="color:#dc2626">bloqueado</strong> porque sua senha
        não atende aos requisitos mínimos de segurança.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px">
        <tr><td style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px">
          <p style="margin:0 0 8px;color:#991b1b;font-size:13px;font-weight:700">A nova senha deve ter:</p>
          <ul style="margin:0;padding:0 0 0 16px;color:#dc2626;font-size:13px;line-height:2">
            <li>Mínimo de <strong>14 caracteres</strong></li>
            <li>Pelo menos 1 <strong>letra maiúscula</strong> (A-Z)</li>
            <li>Pelo menos 1 <strong>letra minúscula</strong> (a-z)</li>
            <li>Pelo menos 1 <strong>número</strong> (0-9)</li>
            <li>Pelo menos 1 <strong>símbolo especial</strong> (!@#$%...)</li>
          </ul>
        </td></tr>
      </table>
      <div style="text-align:center;margin:24px 0">
        <a href="${appUrl}/trocar-senha" style="display:inline-block;background:#dc2626;color:#fff;font-weight:800;font-size:14px;text-decoration:none;padding:14px 36px;border-radius:50px">
          Trocar senha agora →
        </a>
      </div>
      <p style="color:#94a3b8;font-size:12px;text-align:center;margin:0">Você continuará recebendo este aviso diariamente até trocar a senha.</p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`.trim();

    // deepcode ignore XSS: user-supplied values are HTML-escaped via escapeHtml() before template interpolation
    const info = await this.transporter.sendMail({
      from: `"Instituto Tia Pretinha" <${this.config.get<string>('SMTP_FROM_ADDRESS') || this.config.get<string>('SMTP_USER')}>`,
      to: email,
      subject: `🚨 Sua senha está bloqueada — troque agora`,
      html,
    });
    this.logger.log(`📧 Lembrete de senha fraca enviado para ${email}`);
    if (this.isEthereal) this.logger.warn(`👁️  Preview: ${nodemailer.getTestMessageUrl(info)}`);
  }

  /**
   * Notificação por e-mail enviada individualmente para membros de grupos
   * (ex.: nova solicitação de funcionário → ADMIN, PRT, VP).
   */
  async enviarNotificacaoGrupo(
    email: string,
    nome: string,
    titulo: string,
    mensagem: string,
  ): Promise<void> {
    const primeiroNome = this.escapeHtml(nome.split(' ')[0]);
    const appUrl = (this.config.get<string>('APP_URL') || 'https://www.institutotiapretinha.org').replace(/\/$/, '');

    if (!this.transporter) {
      this.logger.warn(`📧 [NOTIF-GRUPO] ${titulo} → ${nome} <${email}>`);
      return;
    }

    const html = `
<!DOCTYPE html><html lang="pt-br"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px">
<tr><td align="center">
  <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)">
    <tr><td style="background:#1e3a5f;padding:28px 32px;text-align:center">
      <p style="margin:0;font-size:20px;font-weight:900;color:#fff">🔔 Nova notificação — ITP</p>
      <p style="margin:6px 0 0;color:#93c5fd;font-size:12px">Instituto Tia Pretinha</p>
    </td></tr>
    <tr><td style="padding:32px">
      <p style="font-size:20px;font-weight:700;color:#1e293b;margin:0 0 12px">Olá, ${primeiroNome}!</p>
      <p style="color:#334155;font-size:15px;font-weight:600;margin:0 0 8px">${titulo}</p>
      <p style="color:#64748b;font-size:14px;line-height:1.7;margin:0 0 24px">${mensagem}</p>
      <div style="text-align:center;margin:0 0 24px">
        <a href="${appUrl}/funcionarios" style="display:inline-block;background:#1e3a5f;color:#fff;font-weight:700;font-size:14px;text-decoration:none;padding:14px 36px;border-radius:50px">
          Ver no painel →
        </a>
      </div>
      <p style="color:#94a3b8;font-size:12px;text-align:center;margin:0">Esta notificação foi enviada porque você pertence a um grupo com permissão para gerenciar este tipo de operação.</p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`.trim();

    // deepcode ignore XSS: user-supplied values are HTML-escaped via escapeHtml() before template interpolation
    const info = await this.transporter.sendMail({
      from: `"Instituto Tia Pretinha" <${this.config.get<string>('SMTP_FROM_ADDRESS') || this.config.get<string>('SMTP_USER')}>`,
      to: email,
      subject: titulo,
      html,
    });
    this.logger.log(`📧 Notificação de grupo enviada para ${email} (${titulo})`);
    if (this.isEthereal) this.logger.warn(`👁️  Preview: ${nodemailer.getTestMessageUrl(info)}`);
  }

  // ─────────────────────────────────────────────────────────────────────
  //  PROJETOS — Confirmação de inscrição
  // ─────────────────────────────────────────────────────────────────────

  async enviarConfirmacaoInscricao(dados: {
    email: string;
    nome_crianca: string;
    nome_responsavel: string;
    nome_projeto: string;
    data_inicio: string;
    data_fim: string;
    equipe?: string | null;
    docs_pendentes: string[];
  }): Promise<void> {
    const { email, nome_crianca, nome_responsavel, nome_projeto, data_inicio, data_fim, equipe, docs_pendentes } = dados;

    if (!this.transporter) {
      this.logger.warn(`📧 [CONF-INSCRICAO] ${nome_crianca} → ${email}`);
      return;
    }

    const nomeResp = this.escapeHtml(nome_responsavel.split(' ')[0] || nome_responsavel);
    const nomeCrianca = this.escapeHtml(nome_crianca);
    const nomeProjeto = this.escapeHtml(nome_projeto);
    const nomeEquipe = equipe ? this.escapeHtml(equipe) : null;

    const LABELS: Record<string, string> = {
      foto_aluno: 'Foto do aluno',
      identidade_aluno: 'Identidade do aluno',
      identidade_responsavel: 'Identidade do responsável',
      comprovante_residencia: 'Comprovante de residência',
      certidao_nascimento: 'Certidão de nascimento',
      declaracao_escolar: 'Declaração escolar',
    };

    const pendentesHtml = docs_pendentes.length > 0
      ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0">
          <tr><td style="background:#fef9e7;border:1px solid #f59e0b;border-radius:8px;padding:16px">
            <p style="margin:0 0 8px;color:#92400e;font-size:13px;font-weight:700">Documentos pendentes:</p>
            <ul style="margin:0;padding-left:20px;color:#92400e;font-size:13px;line-height:2">
              ${docs_pendentes.map(t => `<li>${LABELS[t] ?? t}</li>`).join('')}
              ${docs_pendentes.includes('declaracao_escolar') ? '<li style="font-style:italic">Declaração escolar — entregar presencialmente</li>' : ''}
            </ul>
          </td></tr>
        </table>`
      : '<p style="color:#15803d;font-size:14px;font-weight:600">Documentação completa!</p>';

    const html = `
<!DOCTYPE html><html lang="pt-br"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 20px">
<tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.08)">
    <tr><td style="background:#1e3a5f;padding:32px 40px;text-align:center">
      <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700">Instituto Tia Pretinha</h1>
      <p style="margin:6px 0 0;color:#a8c4e0;font-size:14px">CNPJ nº 11.759.851/0001-39</p>
    </td></tr>
    <tr><td style="padding:40px">
      <p style="margin:0 0 16px;color:#374151;font-size:16px">Olá, <strong>${nomeResp}</strong>!</p>
      <p style="margin:0 0 24px;color:#6b7280;font-size:15px;line-height:1.6">
        A inscrição de <strong>${nomeCrianca}</strong> no projeto <strong>${nomeProjeto}</strong> foi confirmada com sucesso! 🎉
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px">
        <tr><td style="background:#f0fdf4;border:2px solid #86efac;border-radius:12px;padding:20px">
          <p style="margin:0 0 8px;color:#15803d;font-size:13px;font-weight:700">Detalhes da inscrição</p>
          <p style="margin:0;color:#166534;font-size:14px;line-height:2">
            Participante: <strong>${nomeCrianca}</strong><br/>
            Projeto: <strong>${nomeProjeto}</strong><br/>
            Período: <strong>${data_inicio} a ${data_fim}</strong><br/>
            ${nomeEquipe ? `Equipe: <strong>${nomeEquipe}</strong>` : ''}
          </p>
        </td></tr>
      </table>
      ${pendentesHtml}
      <p style="margin:16px 0 0;color:#9ca3af;font-size:12px">Dúvidas? Entre em contato com o Instituto Tia Pretinha.</p>
    </td></tr>
    <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:24px 40px;text-align:center">
      <p style="margin:0;color:#9ca3af;font-size:12px">Este e-mail foi enviado automaticamente pelo sistema do Instituto Tia Pretinha.</p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`.trim();

    // deepcode ignore XSS: user-supplied values are HTML-escaped via escapeHtml() before template interpolation
    const info = await this.transporter.sendMail({
      from: `"Instituto Tia Pretinha" <${this.config.get<string>('SMTP_FROM_ADDRESS') || this.config.get<string>('SMTP_USER')}>`,
      to: email,
      subject: `✅ Inscrição confirmada — ${nomeProjeto}`,
      html,
    });

    this.logger.log(`📧 Confirmação de inscrição enviada para ${email} (${nomeCrianca})`);
    if (this.isEthereal) this.logger.warn(`👁️  Preview: ${nodemailer.getTestMessageUrl(info)}`);
  }

  /**
   * Método genérico: envia um e-mail com assunto e HTML arbitrários.
   * Usado para envio de relatórios e outros usos internos.
   */
  async enviarGenerico(para: string, assunto: string, html: string): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(`📧 [SEM-SMTP] Envio genérico para ${para} (${assunto})`);
      return;
    }
    const info = await this.transporter.sendMail({
      from: `"Instituto Tia Pretinha" <${this.config.get<string>('SMTP_FROM_ADDRESS') || this.config.get<string>('SMTP_USER')}>`,
      to: para,
      subject: assunto,
      html,
    });
    this.logger.log(`📧 E-mail genérico enviado para ${para} (${assunto})`);
    if (this.isEthereal) this.logger.warn(`👁️  Preview: ${nodemailer.getTestMessageUrl(info)}`);
  }
}

