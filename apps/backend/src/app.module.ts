import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { TypeOrmModule, InjectDataSource } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { join } from 'path';
import { DataSource } from 'typeorm';

// Core & Auth
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';

// Entities
import { Usuario } from './usuarios/usuario.entity';
import { Aluno } from './alunos/aluno.entity';
import { Inscricao } from './matriculas/inscricao.entity';
import { InscricaoAnotacao } from './matriculas/inscricao-anotacao.entity';
import { InscricaoMovimentacao } from './matriculas/inscricao-movimentacao.entity';
import { Grupo } from './grupos/grupo.entity';
import { DocumentoInscricao } from './matriculas/documento-inscricao.entity';
import { TurmaAluno } from './academico/entities/turma-aluno.entity';
import { Curso } from './academico/entities/curso.entity';
import { Turma } from './academico/entities/turma.entity';

// Services / Controllers
import { MatriculasModule } from './matriculas/matriculas.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { EmailModule } from './email.module';

// Modules
import { GruposModule } from './grupos/grupos.module';
import { UsersModule } from './modules/users/users.module'; 
import { AcademicoModule } from './academico/academico.module';
import { CadastroModule } from './cadastro/cadastro.module';
import { FuncionariosModule } from './funcionarios/funcionarios.module';
import { FinanceiroModule } from './financeiro/financeiro.module';
import { EstoqueModule } from './estoque/estoque.module';
import { NotificacoesModule } from './notificacoes/notificacoes.module';
import { RelatoriosModule } from './relatorios/relatorios.module';
import { PesquisasModule } from './pesquisas/pesquisas.module';
import { GenteModule } from './gente/gente.module';
import { AlunosModule } from './alunos/alunos.module';
import { PublicoModule } from './publico/publico.module';
import { ProjetosModule } from './projetos/projetos.module';
import { CaptacaoModule } from './captacao/captacao.module';
import { FrontendLogsModule } from './frontend-logs/frontend-logs.module';
import { ResponsaveisModule } from './responsaveis/responsaveis.module';
import { SupabaseModule } from './modules/supabase/supabase.module';
import { MetricsModule } from './metrics/metrics.module';

@Module({
  imports: [
    // 1. Config - Variáveis de Ambiente
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.VERCEL
        ? undefined
        : [
            join(process.cwd(), '.env'),
            join(process.cwd(), '..', '..', '.env'),
          ],
      cache: true,
    }),
    
    // 2. JWT Global - Centralizado
    JwtModule.registerAsync({
      global: true, 
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '3h' },
      }),
    }),
    
    // 3. Conexão com Banco de Dados
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const dbUrl = config.get<string>('DATABASE_URL');
        if (!dbUrl) {
          throw new Error('A variável de ambiente DATABASE_URL não foi definida.');
        }
        // Normaliza sslmode para verify-full (silencia warning do pg v9 sobre sslmode=require)
        const dbUrlSsl = dbUrl.replace(/sslmode=(?:require|prefer|verify-ca)/g, 'sslmode=verify-full');
        // connect_timeout=15 — cada tentativa espera até 15s pelo Neon acordar
        const dbUrlWithTimeout = dbUrlSsl.includes('connect_timeout')
          ? dbUrlSsl
          : (dbUrlSsl.includes('?') ? `${dbUrlSsl}&connect_timeout=15` : `${dbUrlSsl}?connect_timeout=15`);
        return {
          type: 'postgres',
          url: dbUrlWithTimeout,
          // Aparece como app= no log do Postgres: identifica a origem do erro no catálogo.
          applicationName: 'erp-itp-backend',
          entities: [Usuario, Aluno, Inscricao, InscricaoAnotacao, InscricaoMovimentacao, Grupo, DocumentoInscricao],
          autoLoadEntities: true,
          synchronize: false,
          ssl: (dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1') || dbUrl.includes('@postgres:'))
            ? false
            : { rejectUnauthorized: false },
          // Neon recusa conexões durante wake-up (~10s). Com retryDelay=3s,
          // a tentativa 4 (t≈9s) já encontra o banco acordado.
          // 10 tentativas = 30s de cobertura, bem dentro do maxDuration:60s
          retryAttempts: 10,
          retryDelay: 3000,
          // Cada invocação serverless abre seu próprio pool — limitar o tamanho
          // evita esgotar as conexões do Neon quando várias instâncias sobem juntas
          extra: { max: 5, idleTimeoutMillis: 10_000 },
        };
      },
    }),

    // 4. Repositórios
    TypeOrmModule.forFeature([Usuario, Aluno, Grupo, DocumentoInscricao]),
    
    // 5. Módulos Encapsulados (Não adicione os services deles em providers!)
    AuthModule,
    UsuariosModule,
    GruposModule,
    UsersModule,
    AcademicoModule,
    CadastroModule,
    FuncionariosModule,
    FinanceiroModule,
    EstoqueModule,
    NotificacoesModule,
    RelatoriosModule,
    PesquisasModule,
    GenteModule,
    AlunosModule,
    MatriculasModule,
    EmailModule,
    PublicoModule,
    ProjetosModule,
    CaptacaoModule,
    FrontendLogsModule,
    ResponsaveisModule,
    SupabaseModule,
    MetricsModule,
  ],
  controllers: [
    AppController,
  ],
  providers: [
    AppService,
    // O UsersService NÃO deve estar aqui, pois já está dentro do UsersModule
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements OnModuleInit {
  private readonly logger = new Logger('AppModule');

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onModuleInit() {
    // Fire-and-forget: libera o bootstrap imediatamente, evita timeout Vercel no cold start
    setImmediate(() => {
      this.runMigrations().catch(e =>
        this.logger.warn('[migrations background] erro:', e?.message),
      );
    });
  }

  private async runMigrations() {
    try {
      // ── Versão do schema — pula migrations se já rodaram neste banco ──────
      const SCHEMA_VERSION = 26; // incrementar aqui ao adicionar novas migrations
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS _schema_version (
          id      INT PRIMARY KEY DEFAULT 1,
          version INT NOT NULL DEFAULT 0,
          ran_at  TIMESTAMPTZ DEFAULT now(),
          CONSTRAINT single_row CHECK (id = 1)
        )
      `);
      await this.dataSource.query(`INSERT INTO _schema_version (id, version) VALUES (1, 0) ON CONFLICT DO NOTHING`);

      // ── Colunas críticas: sempre garantidas antes do guard de versão ─────────
      // Necessário para evitar race condition em serverless (instâncias paralelas)
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS inscricoes ADD COLUMN IF NOT EXISTS ultima_freq_escolar VARCHAR;
        ALTER TABLE IF EXISTS alunos     ADD COLUMN IF NOT EXISTS ultima_freq_escolar VARCHAR;
      `);

      const [{ version: currentVersion }] = await this.dataSource.query(`SELECT version FROM _schema_version WHERE id = 1`);
      if (Number(currentVersion) >= SCHEMA_VERSION) {
        this.logger.log(`✅ Schema v${SCHEMA_VERSION} já aplicado — migrations ignoradas`);
        return;
      }
      this.logger.log(`⚙️  Aplicando migrations schema v${currentVersion} → v${SCHEMA_VERSION}...`);

      // ── Tabelas críticas criadas PRIMEIRO (antes de qualquer outro await) ──
      // Garante que existam mesmo se a request chegar durante a inicialização

      // Captação — movidas para o topo para evitar 500 durante cold start
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS captacao_opportunities (
          id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          title            TEXT NOT NULL,
          source_type      TEXT NOT NULL CHECK (source_type IN ('edital','grant','patrocinio','lei_incentivo','outro')),
          source_url       TEXT,
          entity_name      TEXT,
          deadline         TIMESTAMPTZ,
          estimated_value  NUMERIC(12,2),
          status           TEXT NOT NULL DEFAULT 'prospeccao'
                             CHECK (status IN ('prospeccao','qualificacao','elaboracao','submissao','aprovado','reprovado','archived')),
          ai_score         SMALLINT CHECK (ai_score >= 0 AND ai_score <= 100),
          ai_confidence    SMALLINT CHECK (ai_confidence >= 0 AND ai_confidence <= 100),
          summary          TEXT,
          match_reasons    JSONB,
          search_metadata  JSONB,
          notes            TEXT,
          created_by       UUID,
          deleted_at       TIMESTAMPTZ,
          expires_at       TIMESTAMPTZ,
          created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`ALTER TABLE captacao_opportunities ADD COLUMN IF NOT EXISTS gemini_raw JSONB`);
      await this.dataSource.query(`ALTER TABLE captacao_opportunities ADD COLUMN IF NOT EXISTS valor_minimo NUMERIC(15,2)`);
      await this.dataSource.query(`ALTER TABLE captacao_opportunities ADD COLUMN IF NOT EXISTS valor_maximo NUMERIC(15,2)`);
      await this.dataSource.query(`ALTER TABLE captacao_opportunities ADD COLUMN IF NOT EXISTS link_edital TEXT`);
      await this.dataSource.query(`ALTER TABLE captacao_opportunities ADD COLUMN IF NOT EXISTS documentos_necessarios JSONB`);
      await this.dataSource.query(`ALTER TABLE captacao_opportunities ADD COLUMN IF NOT EXISTS requisitos_elegibilidade TEXT`);
      await this.dataSource.query(`ALTER TABLE captacao_opportunities ADD COLUMN IF NOT EXISTS modalidade VARCHAR(60)`);
      await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_captacao_opp_status   ON captacao_opportunities(status) WHERE deleted_at IS NULL`);
      await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_captacao_opp_deadline ON captacao_opportunities(deadline) WHERE deleted_at IS NULL`);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS captacao_pipeline_events (
          id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          opportunity_id UUID NOT NULL REFERENCES captacao_opportunities(id) ON DELETE CASCADE,
          from_status    TEXT,
          to_status      TEXT NOT NULL,
          changed_by     UUID,
          notes          TEXT,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_captacao_events_opp ON captacao_pipeline_events(opportunity_id)`);
      this.logger.log('✅ Tabelas críticas captacao garantidas no topo');

      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS chamados_academicos (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          titulo VARCHAR NOT NULL,
          descricao TEXT,
          tipo VARCHAR NOT NULL DEFAULT 'Social',
          status VARCHAR NOT NULL DEFAULT 'aberto',
          prioridade VARCHAR NOT NULL DEFAULT 'normal',
          aluno_id UUID,
          aluno_nome VARCHAR,
          turma_id UUID,
          turma_nome VARCHAR,
          responsavel_nome VARCHAR,
          criado_por_nome VARCHAR,
          observacoes TEXT,
          data_resolucao DATE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      // Colunas adicionadas após criação inicial — garantidas aqui no bloco crítico
      await this.dataSource.query(`
        ALTER TABLE chamados_academicos
          ADD COLUMN IF NOT EXISTS abertura       TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS fechamento     TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS acompanhamento TEXT,
          ADD COLUMN IF NOT EXISTS protocolo      VARCHAR
      `);
      await this.dataSource.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_chamados_protocolo_unique
        ON chamados_academicos (protocolo)
        WHERE protocolo IS NOT NULL
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS chamados_acompanhamentos (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          chamado_id  UUID NOT NULL,
          conteudo    TEXT NOT NULL,
          autor_nome  VARCHAR,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS controles_futebol (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          aluno_id TEXT NOT NULL,
          tamanho_camisa TEXT,
          tamanho_short TEXT,
          numero_chuteira TEXT,
          estoque_uniforme_id TEXT,
          estoque_chuteira_id TEXT,
          uniforme_recebido BOOLEAN NOT NULL DEFAULT false,
          chuteira_recebida BOOLEAN NOT NULL DEFAULT false,
          status TEXT NOT NULL DEFAULT 'Pendente',
          observacoes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      this.logger.log('✅ Tabelas críticas (chamados_academicos, controles_futebol) garantidas');

      // GLPI — filas e base de conhecimento
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS chamados_filas (
          id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          nome                VARCHAR NOT NULL,
          descricao           TEXT,
          sla_horas_resposta  INT NOT NULL DEFAULT 24,
          sla_horas_resolucao INT NOT NULL DEFAULT 72,
          ativo               BOOLEAN NOT NULL DEFAULT true,
          created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`
        INSERT INTO chamados_filas (nome, sla_horas_resposta, sla_horas_resolucao) VALUES
          ('Administração', 8, 48),
          ('Conselho', 24, 72),
          ('Presidência', 4, 24),
          ('Apoio', 24, 72)
        ON CONFLICT DO NOTHING
      `).catch(() => {});
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS chamados_conhecimento (
          id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          titulo         VARCHAR NOT NULL,
          conteudo       TEXT NOT NULL,
          categoria      VARCHAR,
          tags           TEXT[],
          autor_nome     VARCHAR,
          ativo          BOOLEAN NOT NULL DEFAULT true,
          visualizacoes  INT NOT NULL DEFAULT 0,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`
        ALTER TABLE chamados_academicos
          ADD COLUMN IF NOT EXISTS satisfacao  INT,
          ADD COLUMN IF NOT EXISTS fila_nome   VARCHAR
      `);
      await this.dataSource.query(`
        ALTER TABLE chamados_academicos
          ADD COLUMN IF NOT EXISTS origem VARCHAR(50)
      `);
      this.logger.log('✅ GLPI: chamados_filas, chamados_conhecimento e colunas satisfacao/fila_nome/origem garantidos');

      // Corrige chamado específico que foi marcado indevidamente como origem=site
      await this.dataSource.query(`
        UPDATE chamados_academicos
        SET origem = NULL
        WHERE id = 'a2acb211-19b0-4287-ab36-f0156343be9a' AND origem = 'site'
      `);

      // Migrations idempotentes — executam na inicialização em produção ou dev
      await this.dataSource.query(`ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS matricula TEXT UNIQUE`);
      await this.dataSource.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS matricula TEXT UNIQUE`);
      this.logger.log('✅ Migrations de matrícula aplicadas (IF NOT EXISTS)');

      // Coluna usuario_nome em movimentacoes_financeiras
      await this.dataSource.query(`ALTER TABLE movimentacoes_financeiras ADD COLUMN IF NOT EXISTS usuario_nome VARCHAR`);
      this.logger.log('✅ usuario_nome em movimentacoes_financeiras aplicado');

      await this.dataSource.query(`ALTER TABLE projeto_equipes ADD COLUMN IF NOT EXISTS imagem_template TEXT`);
      this.logger.log('✅ imagem_template em projeto_equipes aplicado');

      // Doações DRE — FK doador_id em movimentacoes_financeiras
      await this.dataSource.query(`ALTER TABLE movimentacoes_financeiras ADD COLUMN IF NOT EXISTS doador_id UUID REFERENCES doadores(id)`);
      this.logger.log('✅ doador_id em movimentacoes_financeiras aplicado');

      // Remove FK indevida em grade_horaria (professor_id pode ser de usuarios, não só professores)
      await this.dataSource.query(`ALTER TABLE grade_horaria DROP CONSTRAINT IF EXISTS grade_horaria_professor_id_fkey`);
      // Remove hora_inicio/hora_fim da turma (horários ficam apenas por dia na grade_horaria)
      await this.dataSource.query(`ALTER TABLE turmas DROP COLUMN IF EXISTS hora_inicio`);
      await this.dataSource.query(`ALTER TABLE turmas DROP COLUMN IF EXISTS hora_fim`);
      this.logger.log('✅ grade_horaria FK removida e hora_inicio/hora_fim de turmas removidos');

      // ── Colunas faltantes em funcionarios (schema drift) ─────────────────
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS funcionarios
          ADD COLUMN IF NOT EXISTS raca_cor            TEXT,
          ADD COLUMN IF NOT EXISTS escolaridade        TEXT,
          ADD COLUMN IF NOT EXISTS cep                 TEXT,
          ADD COLUMN IF NOT EXISTS logradouro          TEXT,
          ADD COLUMN IF NOT EXISTS numero_residencia   TEXT,
          ADD COLUMN IF NOT EXISTS bairro              TEXT,
          ADD COLUMN IF NOT EXISTS cidade              TEXT,
          ADD COLUMN IF NOT EXISTS complemento         TEXT,
          ADD COLUMN IF NOT EXISTS estado              TEXT,
          ADD COLUMN IF NOT EXISTS telefone_emergencia_1 TEXT,
          ADD COLUMN IF NOT EXISTS telefone_emergencia_2 TEXT,
          ADD COLUMN IF NOT EXISTS possui_deficiencia  BOOLEAN DEFAULT false,
          ADD COLUMN IF NOT EXISTS deficiencia_descricao TEXT,
          ADD COLUMN IF NOT EXISTS possui_alergias     BOOLEAN DEFAULT false,
          ADD COLUMN IF NOT EXISTS alergias_descricao  TEXT,
          ADD COLUMN IF NOT EXISTS usa_medicamentos    BOOLEAN DEFAULT false,
          ADD COLUMN IF NOT EXISTS medicamentos_descricao TEXT,
          ADD COLUMN IF NOT EXISTS interesse_cursos    BOOLEAN DEFAULT false
      `);
      this.logger.log('✅ Colunas funcionarios (endereço, emergência, saúde) aplicadas (IF NOT EXISTS)');

      // Tabelas de Estoque
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS estoque_produtos (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          nome TEXT NOT NULL,
          categoria TEXT DEFAULT 'Geral',
          unidade_medida TEXT NOT NULL DEFAULT 'un',
          quantidade_atual NUMERIC(12,3) NOT NULL DEFAULT 0,
          estoque_minimo NUMERIC(12,3) NOT NULL DEFAULT 0,
          ativo BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS estoque_movimentos (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          produto_id UUID NOT NULL REFERENCES estoque_produtos(id) ON DELETE CASCADE,
          tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'baixa')),
          quantidade NUMERIC(12,3) NOT NULL,
          observacao TEXT,
          usuario_nome TEXT,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS estoque_categorias (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          nome TEXT NOT NULL UNIQUE,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      // Seed categorias padrão se a tabela estiver vazia
      await this.dataSource.query(`
        INSERT INTO estoque_categorias (nome)
        VALUES ('Insumos - Cozinha'), ('Insumos - Limpeza'), ('Insumos - Material')
        ON CONFLICT (nome) DO NOTHING
      `);
      // Garante colunas adicionadas em versões posteriores (migrations idempotentes)
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS estoque_movimentos
          ADD COLUMN IF NOT EXISTS usuario_nome TEXT,
          ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      `);
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS estoque_categorias
          ADD COLUMN IF NOT EXISTS codigo TEXT UNIQUE
      `);
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS doadores
          ADD COLUMN IF NOT EXISTS codigo_interno TEXT UNIQUE
      `);
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS contas_bancarias
          ADD COLUMN IF NOT EXISTS codigo_interno TEXT UNIQUE
      `);
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS usuarios
          ADD COLUMN IF NOT EXISTS reset_token TEXT,
          ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ
      `);
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS estoque_produtos
          ADD COLUMN IF NOT EXISTS codigo_interno TEXT UNIQUE
      `);

      // ── Tabelas do módulo Acadêmico ───────────────────────────────────────
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS professores (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          nome TEXT NOT NULL,
          especialidade TEXT,
          email TEXT,
          cpf TEXT,
          data_nascimento DATE,
          celular TEXT,
          sexo TEXT,
          raca_cor TEXT,
          escolaridade TEXT,
          cep TEXT,
          numero_residencia TEXT,
          complemento TEXT,
          estado TEXT,
          telefone_emergencia_1 TEXT,
          telefone_emergencia_2 TEXT,
          possui_deficiencia BOOLEAN DEFAULT false,
          deficiencia_descricao TEXT,
          possui_alergias BOOLEAN DEFAULT false,
          alergias_descricao TEXT,
          usa_medicamentos BOOLEAN DEFAULT false,
          medicamentos_descricao TEXT,
          interesse_cursos BOOLEAN DEFAULT false,
          ativo BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      this.logger.log('✅ Tabela professores criada (IF NOT EXISTS)');
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS grade_horaria (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          dia_semana INT,
          horario_inicio TIME NOT NULL,
          horario_fim TIME NOT NULL,
          materia_id TEXT,
          nome_curso TEXT,
          professor_id TEXT,
          nome_professor TEXT,
          turma_id TEXT,
          sala TEXT,
          cor TEXT NOT NULL DEFAULT '#7c3aed'
        )
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS presenca_sessoes (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          turma_id TEXT NOT NULL,
          turma_nome TEXT,
          data DATE NOT NULL,
          tema_aula TEXT,
          conteudo_abordado TEXT,
          usuario_id TEXT,
          usuario_nome TEXT,
          total_presentes INT NOT NULL DEFAULT 0,
          total_ausentes INT NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS diario_academico (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tipo TEXT NOT NULL,
          titulo TEXT,
          descricao TEXT,
          aluno_id TEXT,
          aluno_nome TEXT,
          turma_id TEXT,
          data DATE NOT NULL DEFAULT CURRENT_DATE,
          usuario_id TEXT,
          usuario_nome TEXT,
          sessao_id TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      // Garante colunas adicionais em instâncias existentes
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS presenca_sessoes
          ADD COLUMN IF NOT EXISTS ip_address TEXT
      `);
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS diario_academico
          ADD COLUMN IF NOT EXISTS sessao_id TEXT,
          ADD COLUMN IF NOT EXISTS aluno_nome TEXT,
          ADD COLUMN IF NOT EXISTS inscricao_id INT,
          ADD COLUMN IF NOT EXISTS pessoa_nome TEXT,
          ADD COLUMN IF NOT EXISTS isento BOOLEAN NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS justificada BOOLEAN NOT NULL DEFAULT false
      `);
      this.logger.log('✅ Tabelas acadêmicas criadas/verificadas (IF NOT EXISTS)');
      this.logger.log('✅ Tabelas de estoque criadas (IF NOT EXISTS)');

      // ── Tabela de Notificações ─────────────────────────────────────────────
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS notificacoes (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tipo TEXT NOT NULL,
          titulo TEXT NOT NULL,
          mensagem TEXT NOT NULL,
          lida BOOLEAN NOT NULL DEFAULT false,
          referencia_id TEXT,
          referencia_tipo TEXT,
          usuario_id TEXT,
          criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS notificacoes
          ADD COLUMN IF NOT EXISTS cargo_minimo INT
      `);
      this.logger.log('✅ Tabela notificacoes criada/verificada');

      // Auto-atribuir matrícula a usuários existentes que não possuem
      const semMatricula: { id: string; role: string; createdAt: Date }[] = await this.dataSource.query(
        `SELECT id, role, created_at AS "createdAt" FROM usuarios WHERE matricula IS NULL ORDER BY created_at ASC`
      );
      if (semMatricula.length > 0) {
        this.logger.log(`🔄 Atribuindo matrícula a ${semMatricula.length} usuário(s) sem matrícula...`);
        for (let i = 0; i < semMatricula.length; i++) {
          const u = semMatricula[i];
          const d = u.createdAt ? new Date(u.createdAt) : new Date();
          const yyyymm = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
          const rolePrefix: Record<string, string> = {
            admin: 'ITP-ADM', vp: 'ITP-VP', drt: 'ITP-DRT', adjunto: 'ITP-ADJ',
            prof: 'ITP-PROF', monitor: 'ITP-MNT', assist: 'ITP-AST', cozinha: 'ITP-CZNH',
          };
          const prefix = rolePrefix[u.role?.toLowerCase()] ?? 'ITP-USR';
          const seq = String(i + 1).padStart(3, '0');
          const matricula = `${prefix}-${yyyymm}-${seq}`;
          await this.dataSource.query(
            `UPDATE usuarios SET matricula = $1 WHERE id = $2 AND matricula IS NULL`,
            [matricula, u.id]
          );
        }
        this.logger.log('✅ Matrículas atribuídas aos usuários existentes.');
      }

      // ── Novas colunas (funcionários + usuários) ───────────────────────────
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS funcionarios
          ADD COLUMN IF NOT EXISTS possui_plano_saude BOOLEAN DEFAULT false,
          ADD COLUMN IF NOT EXISTS plano_saude TEXT,
          ADD COLUMN IF NOT EXISTS numero_sus TEXT,
          ADD COLUMN IF NOT EXISTS usuario_id UUID UNIQUE
      `);
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS usuarios
          ADD COLUMN IF NOT EXISTS funcionario_id UUID UNIQUE,
          ADD COLUMN IF NOT EXISTS deve_trocar_senha BOOLEAN NOT NULL DEFAULT false
      `);
      // Email pode ser NULL para contas admin que só acessam via matrícula
      await this.dataSource.query(`ALTER TABLE IF EXISTS usuarios ALTER COLUMN email DROP NOT NULL`);
      this.logger.log('✅ Migrations de funcionários/usuários (novas colunas) aplicadas');

      // ── email_responsavel em inscricoes e alunos ───────────────────────────
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS inscricoes
          ADD COLUMN IF NOT EXISTS email_responsavel VARCHAR
      `);
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS alunos
          ADD COLUMN IF NOT EXISTS email_responsavel VARCHAR
      `);
      this.logger.log('✅ Colunas email_responsavel aplicadas (IF NOT EXISTS)');

      // ── Colunas faltantes em turmas (schema drift) ───────────────────────
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS turmas
          ADD COLUMN IF NOT EXISTS cor       VARCHAR DEFAULT '#7c3aed',
          ADD COLUMN IF NOT EXISTS turno     VARCHAR,
          ADD COLUMN IF NOT EXISTS max_alunos INT DEFAULT 30,
          ADD COLUMN IF NOT EXISTS codigo    VARCHAR
      `);
      this.logger.log('✅ Colunas turmas (cor, turno, max_alunos, codigo) aplicadas (IF NOT EXISTS)');

      // ── Colunas faltantes em turma_alunos (schema drift) ─────────────────
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS turma_alunos
          ADD COLUMN IF NOT EXISTS inscricao_id INT,
          ADD COLUMN IF NOT EXISTS nome_candidato VARCHAR,
          ADD COLUMN IF NOT EXISTS tipo_vinculo VARCHAR NOT NULL DEFAULT 'aluno'
      `);
      this.logger.log('✅ Colunas turma_alunos (inscricao_id, nome_candidato, tipo_vinculo) aplicadas (IF NOT EXISTS)');

      // ── turma_alunos: permitir múltiplas turmas por aluno ─────────────────
      // A constraint UNIQUE(aluno_id) impedia um aluno de estar em mais de 1 turma.
      // Substituir por UNIQUE(aluno_id, turma_id) parcial (exclui backlog com turma_id NULL).
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS turma_alunos
          DROP CONSTRAINT IF EXISTS turma_alunos_aluno_id_key
      `);
      await this.dataSource.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS turma_alunos_aluno_turma_uq
          ON turma_alunos (aluno_id, turma_id)
          WHERE turma_id IS NOT NULL
      `);
      this.logger.log('✅ turma_alunos: constraint multi-turma aplicada');

      // ── Colunas faltantes em diario_academico (schema drift) ──────────────
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS diario_academico
          ADD COLUMN IF NOT EXISTS inscricao_id INT,
          ADD COLUMN IF NOT EXISTS pessoa_nome TEXT
      `);
      this.logger.log('✅ Colunas diario_academico (inscricao_id, pessoa_nome) aplicadas (IF NOT EXISTS)');

      // ── Coluna cor em turmas ───────────────────────────────────────────────
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS turmas
          ADD COLUMN IF NOT EXISTS cor VARCHAR DEFAULT '#7c3aed'
      `);
      this.logger.log('✅ Coluna turmas.cor aplicada (IF NOT EXISTS)');

      // ── Tabelas de Pesquisas de Satisfação ───────────────────────────────────
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS pesquisas (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          titulo TEXT NOT NULL,
          tipo TEXT NOT NULL,
          perguntas JSONB,
          data_limite TIMESTAMPTZ,
          status TEXT NOT NULL DEFAULT 'aberta',
          link_unico TEXT UNIQUE NOT NULL,
          criado_por_id TEXT,
          criado_por_nome TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS pesquisas_respostas (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          pesquisa_id UUID NOT NULL REFERENCES pesquisas(id) ON DELETE CASCADE,
          respostas JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      this.logger.log('✅ Tabelas pesquisas/pesquisas_respostas criadas (IF NOT EXISTS)');

      // ── Remover FK turmas→professores (professor_id agora referencia usuarios) ──
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS turmas
          DROP CONSTRAINT IF EXISTS turmas_professor_id_fkey
      `);
      this.logger.log('✅ FK turmas_professor_id_fkey removida (IF EXISTS)');

      // ── Coluna nome_turma em grade_horaria ────────────────────────────────
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS grade_horaria
          ADD COLUMN IF NOT EXISTS nome_turma TEXT
      `);
      this.logger.log('✅ Coluna grade_horaria.nome_turma aplicada (IF NOT EXISTS)');

      // ── Colunas de valor/preço no estoque ────────────────────────────────
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS estoque_produtos
          ADD COLUMN IF NOT EXISTS valor_compra NUMERIC(12,2)
      `);
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS estoque_movimentos
          ADD COLUMN IF NOT EXISTS preco_pago NUMERIC(12,2)
      `);
      this.logger.log('✅ Colunas valor_compra/preco_pago aplicadas (IF NOT EXISTS)');

      // ── Coluna categoria em pesquisas ─────────────────────────────────────
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS pesquisas
          ADD COLUMN IF NOT EXISTS categoria TEXT
      `);
      this.logger.log('✅ Coluna pesquisas.categoria aplicada (IF NOT EXISTS)');

      // ── Coluna expurgado em pesquisas_respostas ────────────────────────────
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS pesquisas_respostas
          ADD COLUMN IF NOT EXISTS expurgado BOOLEAN NOT NULL DEFAULT false
      `);
      this.logger.log('✅ Coluna pesquisas_respostas.expurgado aplicada (IF NOT EXISTS)');

      // ── Módulo Gente ──────────────────────────────────────────────────────
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS gente_colaboradores (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          funcionario_id UUID NOT NULL UNIQUE,
          tipo TEXT NOT NULL DEFAULT 'funcionario',
          horario_entrada TEXT,
          horario_saida TEXT,
          dias_trabalho JSONB,
          latitude_permitida NUMERIC(10,7),
          longitude_permitida NUMERIC(10,7),
          raio_metros INT DEFAULT 100,
          ativo BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS gente_recibos (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          colaborador_id UUID NOT NULL,
          mes_referencia TEXT NOT NULL,
          valor NUMERIC(12,2) NOT NULL DEFAULT 0,
          descricao TEXT,
          data_pagamento DATE,
          status TEXT NOT NULL DEFAULT 'pendente',
          observacao TEXT,
          criado_por_id TEXT,
          criado_por_nome TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS gente_vales (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          colaborador_id UUID NOT NULL,
          tipo TEXT NOT NULL DEFAULT 'outro',
          valor NUMERIC(12,2) NOT NULL,
          data DATE NOT NULL,
          descricao TEXT,
          descontado BOOLEAN NOT NULL DEFAULT false,
          criado_por_id TEXT,
          criado_por_nome TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS gente_advertencias (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          colaborador_id UUID NOT NULL,
          data DATE NOT NULL,
          motivo TEXT NOT NULL,
          descricao TEXT,
          nivel TEXT NOT NULL DEFAULT 'escrita',
          criado_por_id TEXT,
          criado_por_nome TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS gente_suspensoes (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          colaborador_id UUID NOT NULL,
          data_inicio DATE NOT NULL,
          data_fim DATE NOT NULL,
          motivo TEXT NOT NULL,
          com_desconto BOOLEAN NOT NULL DEFAULT true,
          criado_por_id TEXT,
          criado_por_nome TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS gente_faltas (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          colaborador_id UUID NOT NULL,
          data DATE NOT NULL,
          justificada BOOLEAN NOT NULL DEFAULT false,
          motivo TEXT,
          com_desconto BOOLEAN NOT NULL DEFAULT true,
          observacao TEXT,
          criado_por_id TEXT,
          criado_por_nome TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS gente_codigos_ajuda (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          codigo TEXT NOT NULL UNIQUE,
          descricao TEXT NOT NULL,
          valor_base NUMERIC(12,2) NOT NULL DEFAULT 0,
          ativo BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS gente_colaborador_codigos (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          colaborador_id UUID NOT NULL,
          codigo_id UUID NOT NULL REFERENCES gente_codigos_ajuda(id) ON DELETE CASCADE,
          valor_personalizado NUMERIC(12,2),
          ativo BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS funcionarios
          ADD COLUMN IF NOT EXISTS foto TEXT,
          ADD COLUMN IF NOT EXISTS estado_civil TEXT,
          ADD COLUMN IF NOT EXISTS pais TEXT DEFAULT 'Brasil',
          ADD COLUMN IF NOT EXISTS rg TEXT,
          ADD COLUMN IF NOT EXISTS orgao_emissor_rg TEXT,
          ADD COLUMN IF NOT EXISTS data_emissao_rg DATE
      `);
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS gente_colaboradores
          ADD COLUMN IF NOT EXISTS salario_base NUMERIC(12,2)
      `);
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS gente_colaboradores
          ADD COLUMN IF NOT EXISTS jornada_flexivel BOOLEAN NOT NULL DEFAULT false
      `);
      await this.dataSource.query(`ALTER TABLE gente_colaboradores ADD COLUMN IF NOT EXISTS horas_dia_flex INT`);
      await this.dataSource.query(`ALTER TABLE gente_colaboradores ADD COLUMN IF NOT EXISTS horario_flexivel_semana JSONB`);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS gente_folga_solicitacoes (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          colaborador_id UUID NOT NULL REFERENCES gente_colaboradores(id) ON DELETE CASCADE,
          data DATE NOT NULL,
          status TEXT NOT NULL DEFAULT 'pendente',
          motivo TEXT,
          respondido_por TEXT,
          respondido_em TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS gente_trabalho_externo (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          colaborador_id UUID NOT NULL REFERENCES gente_colaboradores(id) ON DELETE CASCADE,
          data DATE NOT NULL,
          autorizado_por TEXT NOT NULL,
          autorizado_por_id UUID,
          ativo BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS gente_colaborador_locais (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          colaborador_id UUID NOT NULL REFERENCES gente_colaboradores(id) ON DELETE CASCADE,
          nome TEXT NOT NULL,
          latitude NUMERIC(10,7) NOT NULL,
          longitude NUMERIC(10,7) NOT NULL,
          raio_metros INT NOT NULL DEFAULT 100,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS gente_faltas
          ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'falta',
          ADD COLUMN IF NOT EXISTS data_fim DATE
      `);
      this.logger.log('✅ Colunas gente_faltas (tipo, data_fim) aplicadas (IF NOT EXISTS)');
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS gente_faltas
          ADD COLUMN IF NOT EXISTS percentual_desconto FLOAT
      `);
      this.logger.log('✅ Coluna gente_faltas.percentual_desconto aplicada (IF NOT EXISTS)');
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS gente_faltas
          ADD COLUMN IF NOT EXISTS anexo TEXT,
          ADD COLUMN IF NOT EXISTS anexo_nome TEXT
      `);
      this.logger.log('✅ Colunas gente_faltas (anexo, anexo_nome) aplicadas (IF NOT EXISTS)');
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS funcionarios
          ADD COLUMN IF NOT EXISTS genero TEXT,
          ADD COLUMN IF NOT EXISTS pertence_comunidade_tradicional BOOLEAN DEFAULT false,
          ADD COLUMN IF NOT EXISTS comunidade_tradicional TEXT,
          ADD COLUMN IF NOT EXISTS possui_cad_unico BOOLEAN DEFAULT false,
          ADD COLUMN IF NOT EXISTS baixo_idh BOOLEAN DEFAULT false
      `);
      this.logger.log('✅ Colunas funcionarios (genero, comunidade, cad_unico, baixo_idh) aplicadas (IF NOT EXISTS)');
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS gente_folga_solicitacoes
          ADD COLUMN IF NOT EXISTS realizada BOOLEAN
      `);
      this.logger.log('✅ Coluna gente_folga_solicitacoes.realizada aplicada (IF NOT EXISTS)');
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS gente_colaboradores
          ADD COLUMN IF NOT EXISTS valor_passagem NUMERIC(10,2)
      `);
      this.logger.log('✅ Coluna gente_colaboradores.valor_passagem aplicada (IF NOT EXISTS)');
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS gente_colaboradores
          ADD COLUMN IF NOT EXISTS pagamento_isento BOOLEAN DEFAULT false
      `);
      this.logger.log('✅ Coluna gente_colaboradores.pagamento_isento aplicada (IF NOT EXISTS)');
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS funcionarios
          ADD COLUMN IF NOT EXISTS data_nascimento DATE,
          ADD COLUMN IF NOT EXISTS celular TEXT,
          ADD COLUMN IF NOT EXISTS sexo TEXT
      `);
      this.logger.log('✅ Colunas funcionarios (data_nascimento, celular, sexo) garantidas (IF NOT EXISTS)');
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS gente_advertencias
          ADD COLUMN IF NOT EXISTS valor_desconto NUMERIC(10,2)
      `);
      this.logger.log('✅ Coluna gente_advertencias.valor_desconto aplicada (IF NOT EXISTS)');
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS gente_vales
          ADD COLUMN IF NOT EXISTS forma_pagamento TEXT,
          ADD COLUMN IF NOT EXISTS movimentacao_saida_id TEXT,
          ADD COLUMN IF NOT EXISTS movimentacao_entrada_id TEXT
      `);
      this.logger.log('✅ Colunas gente_vales (forma_pagamento, movimentacao_saida_id, movimentacao_entrada_id) aplicadas (IF NOT EXISTS)');
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS gente_vt_assinaturas (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          colaborador_id UUID NOT NULL,
          mes_referencia VARCHAR(7) NOT NULL,
          assinado BOOLEAN NOT NULL DEFAULT false,
          data_assinatura DATE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE(colaborador_id, mes_referencia)
        )
      `);
      this.logger.log('✅ Tabela gente_vt_assinaturas criada (IF NOT EXISTS)');
      this.logger.log('✅ Tabelas do módulo Gente criadas (IF NOT EXISTS)');

      // ── Módulo Alunos: complemento + validação de documentos ──────────────
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS alunos_complemento (
          id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          aluno_id         UUID NOT NULL UNIQUE REFERENCES alunos(id) ON DELETE CASCADE,
          rg               VARCHAR,
          orgao_expedidor  VARCHAR,
          uf_expedicao     CHAR(2),
          genero           VARCHAR,
          banco            VARCHAR,
          agencia          VARCHAR,
          agencia_digito   VARCHAR,
          conta_corrente   VARCHAR,
          conta_digito     VARCHAR,
          tipo_conta       VARCHAR,
          created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS documentos_validacao (
          id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          aluno_id          UUID NOT NULL REFERENCES alunos(id) ON DELETE CASCADE,
          tipo              VARCHAR NOT NULL,
          url_drive         TEXT,
          status            VARCHAR NOT NULL DEFAULT 'pendente',
          motivo_pendencia  TEXT,
          validado_por_id   TEXT,
          validado_por_nome VARCHAR,
          validado_em       TIMESTAMPTZ,
          created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (aluno_id, tipo)
        )
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS documentos_validacao_aluno_idx
          ON documentos_validacao (aluno_id)
      `);
      // auto_declaracao: campo global aplicado a todos os alunos
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS alunos
          ADD COLUMN IF NOT EXISTS auto_declaracao VARCHAR
      `);
      // Novos campos: orientação sexual e nome da mãe/responsável
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS alunos_complemento
          ADD COLUMN IF NOT EXISTS orientacao_sexual VARCHAR,
          ADD COLUMN IF NOT EXISTS nome_mae VARCHAR
      `);
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS inscricoes
          ADD COLUMN IF NOT EXISTS auto_declaracao VARCHAR,
          ADD COLUMN IF NOT EXISTS orientacao_sexual VARCHAR
      `);
      this.logger.log('✅ Tabelas alunos_complemento / documentos_validacao criadas (IF NOT EXISTS)');

      // ── CPF, email e celular opcionais em inscricoes ───────────────────────
      await this.dataSource.query(`ALTER TABLE IF EXISTS inscricoes ALTER COLUMN cpf DROP NOT NULL`);
      await this.dataSource.query(`ALTER TABLE IF EXISTS inscricoes ALTER COLUMN email DROP NOT NULL`);
      await this.dataSource.query(`ALTER TABLE IF EXISTS inscricoes ALTER COLUMN celular DROP NOT NULL`);
      this.logger.log('✅ cpf/email/celular em inscricoes passaram a ser opcionais (DROP NOT NULL)');

      // ── CPF de alunos: limpar dados inválidos e usar índice parcial ──────────
      // Converte strings vazias e placeholders TEMP... para NULL (crianças sem CPF)
      await this.dataSource.query(`
        UPDATE alunos SET cpf = NULL
        WHERE cpf = '' OR cpf ILIKE 'TEMP%'
      `);
      // Substitui o unique constraint completo por índice parcial (permite múltiplos NULLs
      // e ignora duplicatas de CPF nulo — apenas CPFs reais precisam ser únicos)
      await this.dataSource.query(`
        ALTER TABLE alunos DROP CONSTRAINT IF EXISTS "UQ_1f9a8f3f4e5a314a2d7f828a605"
      `);
      await this.dataSource.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS alunos_cpf_unico
        ON alunos(cpf)
        WHERE cpf IS NOT NULL
      `);
      this.logger.log('✅ alunos.cpf: dados TEMP limpos, constraint substituída por índice parcial');

      // ── Tabela de Chamados Acadêmicos ─────────────────────────────────────
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS chamados_academicos (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          titulo VARCHAR NOT NULL,
          descricao TEXT,
          tipo VARCHAR NOT NULL DEFAULT 'Social',
          status VARCHAR NOT NULL DEFAULT 'aberto',
          prioridade VARCHAR NOT NULL DEFAULT 'normal',
          aluno_id UUID,
          aluno_nome VARCHAR,
          turma_id UUID,
          turma_nome VARCHAR,
          responsavel_nome VARCHAR,
          criado_por_nome VARCHAR,
          observacoes TEXT,
          data_resolucao DATE,
          abertura   TIMESTAMPTZ,
          fechamento TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      this.logger.log('✅ Tabela chamados_academicos criada (IF NOT EXISTS)');
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS chamados_academicos
          ADD COLUMN IF NOT EXISTS abertura        TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS fechamento      TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS acompanhamento  TEXT
      `);

      // Fire-and-forget: não bloqueia o bootstrap (evita timeout Vercel 30s)
      this.dataSource.query(`
        INSERT INTO diario_academico (id, tipo, titulo, descricao, turma_id, data, sessao_id, usuario_id, usuario_nome, created_at)
        SELECT
          gen_random_uuid(),
          'Lista de Chamada',
          COALESCE(ps.turma_nome, 'Turma') || CASE WHEN ps.tema_aula IS NOT NULL AND ps.tema_aula <> '' THEN ' — ' || ps.tema_aula ELSE '' END,
          CONCAT(
            ps.total_presentes, ' presente', CASE WHEN ps.total_presentes != 1 THEN 's' ELSE '' END,
            ' · ', ps.total_ausentes, ' ausente', CASE WHEN ps.total_ausentes != 1 THEN 's' ELSE '' END
          ),
          ps.turma_id,
          ps.data,
          ps.id::text,
          ps.usuario_id,
          ps.usuario_nome,
          ps.created_at
        FROM presenca_sessoes ps
        WHERE NOT EXISTS (
          SELECT 1 FROM diario_academico d
          WHERE d.sessao_id = ps.id::text AND d.tipo = 'Lista de Chamada'
        )
      `).then(() => this.logger.log('✅ Entradas retroativas "Lista de Chamada" criadas'))
        .catch(e => this.logger.warn('retroativo diário (ignorado):', e.message));

      // ── Controle Futebol ────────────────────────────────────────────────────
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS controles_futebol (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          aluno_id TEXT NOT NULL,
          tamanho_camisa TEXT,
          tamanho_short TEXT,
          numero_chuteira TEXT,
          estoque_uniforme_id TEXT,
          estoque_chuteira_id TEXT,
          uniforme_recebido BOOLEAN NOT NULL DEFAULT false,
          chuteira_recebida BOOLEAN NOT NULL DEFAULT false,
          status TEXT NOT NULL DEFAULT 'Pendente',
          observacoes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      this.logger.log('✅ Tabela controles_futebol criada (IF NOT EXISTS)');

      // ── Controle Ballet ──────────────────────────────────────────────────────
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS controles_ballet (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          aluno_id TEXT NOT NULL,
          tamanho_roupa TEXT,
          numero_sapatilha TEXT,
          tamanho_meia TEXT,
          estoque_roupa_id TEXT,
          estoque_sapatilha_id TEXT,
          roupa_encomendada BOOLEAN NOT NULL DEFAULT false,
          sapatilha_encomendada BOOLEAN NOT NULL DEFAULT false,
          roupa_entregue BOOLEAN NOT NULL DEFAULT false,
          sapatilha_entregue BOOLEAN NOT NULL DEFAULT false,
          status TEXT NOT NULL DEFAULT 'Pendente',
          observacoes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      this.logger.log('✅ Tabela controles_ballet criada (IF NOT EXISTS)');

      // ── Controle Ballet — colunas de pagamento (idempotente) ─────────────────
      await this.dataSource.query(`ALTER TABLE controles_ballet ADD COLUMN IF NOT EXISTS itens_pendentes TEXT`);
      await this.dataSource.query(`ALTER TABLE controles_ballet ADD COLUMN IF NOT EXISTS valor_total NUMERIC(10,2)`);
      await this.dataSource.query(`ALTER TABLE controles_ballet ADD COLUMN IF NOT EXISTS valor_entrada NUMERIC(10,2)`);
      await this.dataSource.query(`ALTER TABLE controles_ballet ADD COLUMN IF NOT EXISTS data_entrada DATE`);
      await this.dataSource.query(`ALTER TABLE controles_ballet ADD COLUMN IF NOT EXISTS forma_pagamento TEXT`);
      await this.dataSource.query(`ALTER TABLE controles_ballet ADD COLUMN IF NOT EXISTS num_parcelas INTEGER`);
      await this.dataSource.query(`ALTER TABLE controles_ballet ADD COLUMN IF NOT EXISTS valor_parcela NUMERIC(10,2)`);
      await this.dataSource.query(`ALTER TABLE controles_ballet ADD COLUMN IF NOT EXISTS venc_1 DATE`);
      await this.dataSource.query(`ALTER TABLE controles_ballet ADD COLUMN IF NOT EXISTS venc_2 DATE`);
      await this.dataSource.query(`ALTER TABLE controles_ballet ADD COLUMN IF NOT EXISTS venc_3 DATE`);
      await this.dataSource.query(`ALTER TABLE controles_ballet ADD COLUMN IF NOT EXISTS status_pagamento TEXT DEFAULT 'pendente'`);
      await this.dataSource.query(`ALTER TABLE controles_ballet ADD COLUMN IF NOT EXISTS movimentacao_ids JSONB DEFAULT '[]'`);
      this.logger.log('✅ Colunas de pagamento em controles_ballet aplicadas (IF NOT EXISTS)');

      // ── Boletos a Receber ────────────────────────────────────────────────────
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS boletos (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          recebedor TEXT NOT NULL,
          credor TEXT NOT NULL,
          cnpj TEXT,
          valor NUMERIC(15,2) NOT NULL DEFAULT 0,
          cod_barras TEXT,
          data_emissao DATE NOT NULL,
          parcelado BOOLEAN NOT NULL DEFAULT false,
          qtd_parcelas INT NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'Pendente',
          arquivo_base64 TEXT,
          arquivo_nome TEXT,
          descricao TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS boleto_parcelas (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          boleto_id UUID NOT NULL REFERENCES boletos(id) ON DELETE CASCADE,
          numero_parcela INT NOT NULL,
          valor NUMERIC(15,2) NOT NULL,
          data_vencimento DATE NOT NULL,
          data_pagamento DATE,
          pago BOOLEAN NOT NULL DEFAULT false,
          movimentacao_id UUID,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      this.logger.log('✅ Tabelas boletos/boleto_parcelas criadas (IF NOT EXISTS)');
      await this.dataSource.query(`
        ALTER TABLE boletos
          ADD COLUMN IF NOT EXISTS pessoa_nome TEXT,
          ADD COLUMN IF NOT EXISTS pessoa_tipo TEXT
      `);
      this.logger.log('✅ Colunas boletos (pessoa_nome, pessoa_tipo) aplicadas (IF NOT EXISTS)');
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS boleto_parcelas
          ADD COLUMN IF NOT EXISTS cod_barras TEXT
      `);
      this.logger.log('✅ Coluna boleto_parcelas.cod_barras aplicada (IF NOT EXISTS)');
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS inscricoes
          ADD COLUMN IF NOT EXISTS lgpd_user_agent TEXT
      `);
      this.logger.log('✅ Coluna inscricoes.lgpd_user_agent aplicada (IF NOT EXISTS)');

      // ── Permissões: módulo chamados + fix academico.incluir ───────────────
      // Adiciona 'chamados' a todos os grupos que têm 'academico' configurado
      await this.dataSource.query(`
        UPDATE grupos
        SET grupo_permissoes = jsonb_set(
          jsonb_set(
            grupo_permissoes,
            '{permissoes,chamados}',
            '{"visualizar":true,"incluir":true,"editar":true,"excluir":false}'::jsonb,
            true
          ),
          '{modulos_visiveis,chamados}',
          'true'::jsonb,
          true
        )
        WHERE grupo_permissoes->'permissoes' ? 'academico'
          AND NOT (grupo_permissoes->'permissoes' ? 'chamados')
      `);
      // Garante academico.incluir e academico.editar para grupos que podem visualizar academico
      await this.dataSource.query(`
        UPDATE grupos
        SET grupo_permissoes = jsonb_set(
          jsonb_set(
            grupo_permissoes,
            '{permissoes,academico,incluir}',
            'true'::jsonb,
            true
          ),
          '{permissoes,academico,editar}',
          'true'::jsonb,
          true
        )
        WHERE grupo_permissoes->'permissoes'->'academico'->>'visualizar' = 'true'
      `);
      this.logger.log('✅ Permissões grupos: chamados adicionado + academico.incluir/editar garantidos');

      // ── Pagamentos de Passagem (Transporte diário) ────────────────────────
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS gente_pagamentos_passagem (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          colaborador_id  UUID NOT NULL,
          funcionario_id  UUID NOT NULL,
          data            DATE NOT NULL,
          valor           NUMERIC(10,2) NOT NULL,
          status          VARCHAR NOT NULL DEFAULT 'pago',
          mes_referencia  VARCHAR(7) NOT NULL,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (colaborador_id, data)
        )
      `);
      this.logger.log('✅ Tabela gente_pagamentos_passagem criada (IF NOT EXISTS)');

      // ── Módulo Projetos / Colônia de Férias ───────────────────────────────
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS projetos (
          id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          nome                 VARCHAR NOT NULL,
          descricao            TEXT,
          data_inicio          DATE NOT NULL,
          data_fim             DATE NOT NULL,
          pulseira_largura_mm  INT NOT NULL DEFAULT 54,
          pulseira_altura_mm   INT NOT NULL DEFAULT 25,
          ativo                BOOLEAN NOT NULL DEFAULT true,
          created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS projeto_equipes (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          projeto_id  UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
          nome        VARCHAR NOT NULL,
          cor         VARCHAR NOT NULL DEFAULT '#7c3aed',
          faixa_min   INT,
          faixa_max   INT,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS projeto_inscricoes (
          id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          projeto_id           UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
          equipe_id            UUID REFERENCES projeto_equipes(id) ON DELETE SET NULL,
          aluno_id             UUID,
          tipo                 VARCHAR NOT NULL DEFAULT 'externo',
          nome_completo        VARCHAR NOT NULL,
          data_nascimento      DATE,
          nome_responsavel     VARCHAR,
          telefone_responsavel VARCHAR,
          cuidado_especial     VARCHAR,
          detalhes_cuidado     TEXT,
          status               VARCHAR NOT NULL DEFAULT 'inscrito',
          convertido_em_aluno  BOOLEAN NOT NULL DEFAULT false,
          created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`
        ALTER TABLE projeto_inscricoes
          ADD COLUMN IF NOT EXISTS cep         VARCHAR,
          ADD COLUMN IF NOT EXISTS logradouro  VARCHAR,
          ADD COLUMN IF NOT EXISTS numero      VARCHAR,
          ADD COLUMN IF NOT EXISTS complemento VARCHAR
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS projeto_presencas (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          projeto_id    UUID NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
          equipe_id     UUID REFERENCES projeto_equipes(id) ON DELETE SET NULL,
          inscricao_id  UUID NOT NULL REFERENCES projeto_inscricoes(id) ON DELETE CASCADE,
          data          DATE NOT NULL,
          presente      BOOLEAN NOT NULL DEFAULT false,
          hora_entrada  TIME,
          hora_saida    TIME,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (inscricao_id, data)
        )
      `);
      await this.dataSource.query(`
        ALTER TABLE projeto_inscricoes
          ADD COLUMN IF NOT EXISTS email_responsavel VARCHAR
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS projeto_inscricao_documentos (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          inscricao_id  UUID NOT NULL REFERENCES projeto_inscricoes(id) ON DELETE CASCADE,
          tipo          VARCHAR NOT NULL,
          url_arquivo   TEXT NOT NULL,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_proj_insc_docs_inscricao
          ON projeto_inscricao_documentos(inscricao_id)
      `);
      this.logger.log('✅ Tabelas módulo Projetos criadas (IF NOT EXISTS)');

      // ── Módulo Captação ────────────────────────────────────────────────────
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS captacao_opportunities (
          id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          title            TEXT NOT NULL,
          source_type      TEXT NOT NULL CHECK (source_type IN ('edital','grant','patrocinio','lei_incentivo','outro')),
          source_url       TEXT,
          entity_name      TEXT,
          deadline         TIMESTAMPTZ,
          estimated_value  NUMERIC(12,2),
          status           TEXT NOT NULL DEFAULT 'prospeccao'
                             CHECK (status IN ('prospeccao','qualificacao','elaboracao','submissao','aprovado','reprovado','archived')),
          ai_score         SMALLINT CHECK (ai_score >= 0 AND ai_score <= 100),
          ai_confidence    SMALLINT CHECK (ai_confidence >= 0 AND ai_confidence <= 100),
          summary          TEXT,
          match_reasons    JSONB,
          search_metadata  JSONB,
          notes            TEXT,
          created_by       UUID,
          deleted_at       TIMESTAMPTZ,
          expires_at       TIMESTAMPTZ,
          created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_captacao_opp_status   ON captacao_opportunities(status) WHERE deleted_at IS NULL`);
      await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_captacao_opp_deadline ON captacao_opportunities(deadline) WHERE deleted_at IS NULL`);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS captacao_pipeline_events (
          id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          opportunity_id UUID NOT NULL REFERENCES captacao_opportunities(id) ON DELETE CASCADE,
          from_status    TEXT,
          to_status      TEXT NOT NULL,
          changed_by     UUID,
          notes          TEXT,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_captacao_events_opp ON captacao_pipeline_events(opportunity_id)`);
      // Adiciona coluna gemini_raw se não existir (tabela pode ter sido criada antes desta coluna)
      await this.dataSource.query(`ALTER TABLE captacao_opportunities ADD COLUMN IF NOT EXISTS gemini_raw JSONB`);
      this.logger.log('✅ Tabelas módulo Captação criadas (IF NOT EXISTS)');

      // ── Plano de Contas: grupo + novos planos ──────────────────────────────
      await this.dataSource.query(`ALTER TABLE planos_contas ADD COLUMN IF NOT EXISTS grupo VARCHAR(50)`);
      await this.dataSource.query(`ALTER TABLE gente_recibos ADD COLUMN IF NOT EXISTS movimentacao_id UUID REFERENCES movimentacoes_financeiras(id) ON DELETE SET NULL`);
      // Insere planos padrão com grupos (ON CONFLICT UPDATE grupo se já existir)
      await this.dataSource.query(`
        INSERT INTO planos_contas (nome, descricao, grupo, ativo) VALUES
          ('Adiantamentos a Funcionários', 'Adiantamentos e vales a recuperar via folha', 'Ativo', true),
          ('Contas a Receber',             'Boletos e valores a receber',                  'Ativo', true),
          ('Caixa',                        'Dinheiro em caixa físico',                     'Ativo', true),
          ('Banco',                        'Conta bancária Cora Digital',                  'Ativo', true),
          ('Salários a Pagar',             'Folha de pagamento pendente',                  'Passivo', true),
          ('Doações 2026',                 'Receitas de doações',                          'Receitas', true),
          ('Uniformes 2026',               'Receitas e custos de uniformes',               'Receitas', true),
          ('Funcionarios 2026',            'Despesas com pessoal',                         'Despesas', true),
          ('Cozinha 2026',                 'Despesas com insumos de cozinha',              'Despesas', true),
          ('Materiais 2026',               'Despesas com materiais e insumos',             'Despesas', true),
          ('Celia 2026',                   'Movimentações custeadas por Célia',            'Despesas', true),
          ('Boletos a Receber',            'Parcelas de boletos emitidos',                 'Ativo', true)
        ON CONFLICT (nome) DO UPDATE SET grupo = EXCLUDED.grupo WHERE planos_contas.grupo IS NULL
      `);
      // Corrigir inconsistência de acento em registros existentes
      await this.dataSource.query(`
        UPDATE movimentacoes_financeiras SET plano_contas = 'Funcionarios 2026'
        WHERE plano_contas = 'Funcionários 2026'
      `);
      this.logger.log('✅ Plano de contas: grupos e novos planos atualizados');

      // ── Coluna ativo em usuarios ──────────────────────────────────────────
      await this.dataSource.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT TRUE`);
      this.logger.log('✅ usuarios.ativo adicionado');

      // ── Tabela config_listas (listas de opções configuráveis) ─────────────
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS config_listas (
          chave VARCHAR(100) PRIMARY KEY,
          itens JSONB NOT NULL DEFAULT '[]',
          updated_at TIMESTAMPTZ DEFAULT now()
        )
      `);
      await this.dataSource.query(`
        INSERT INTO config_listas (chave, itens) VALUES
          ('chamados_tipos', '["Social","Acadêmico","Saúde","Família","Financeiro","Gente","Suporte","TI","Outro"]'),
          ('chamados_prioridades', '["baixa","normal","alta","urgente"]'),
          ('projetos_categorias', '["Colônia de Férias","Esporte","Cultura","Reforço Escolar","Outros"]'),
          ('documentos_tipos_chamado', '[]')
        ON CONFLICT (chave) DO NOTHING
      `);
      this.logger.log('✅ config_listas criada e populada com padrões');

      // ── ultima_freq_escolar em inscricoes e alunos ────────────────────────
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS inscricoes
          ADD COLUMN IF NOT EXISTS ultima_freq_escolar VARCHAR
      `);
      await this.dataSource.query(`
        ALTER TABLE IF EXISTS alunos
          ADD COLUMN IF NOT EXISTS ultima_freq_escolar VARCHAR
      `);
      this.logger.log('✅ ultima_freq_escolar adicionado em inscricoes e alunos');

      // v15: tamanho_bytes em projeto_inscricao_documentos
      await this.dataSource.query(`
        ALTER TABLE projeto_inscricao_documentos
          ADD COLUMN IF NOT EXISTS tamanho_bytes INTEGER
      `);
      this.logger.log('✅ tamanho_bytes adicionado em projeto_inscricao_documentos');

      // v16: colunas extras em projeto_inscricoes
      await this.dataSource.query(`
        ALTER TABLE projeto_inscricoes
          ADD COLUMN IF NOT EXISTS bairro VARCHAR,
          ADD COLUMN IF NOT EXISTS cidade VARCHAR,
          ADD COLUMN IF NOT EXISTS estado_uf VARCHAR(2),
          ADD COLUMN IF NOT EXISTS cpf VARCHAR,
          ADD COLUMN IF NOT EXISTS celular VARCHAR,
          ADD COLUMN IF NOT EXISTS sexo VARCHAR
      `);
      this.logger.log('✅ colunas extras adicionadas em projeto_inscricoes');

      // v17: nome_arquivo em projeto_inscricao_documentos
      await this.dataSource.query(`
        ALTER TABLE projeto_inscricao_documentos
          ADD COLUMN IF NOT EXISTS nome_arquivo VARCHAR
      `);
      this.logger.log('✅ nome_arquivo adicionado em projeto_inscricao_documentos');

      // v18: email do participante em projeto_inscricoes
      await this.dataSource.query(`
        ALTER TABLE projeto_inscricoes
          ADD COLUMN IF NOT EXISTS email VARCHAR
      `);
      this.logger.log('✅ email adicionado em projeto_inscricoes');

      // v19: tabela de responsáveis + FK em projeto_inscricoes
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS responsaveis (
          id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          nome_completo    VARCHAR NOT NULL,
          cpf              VARCHAR,
          data_nascimento  DATE,
          email            VARCHAR,
          telefone         VARCHAR,
          cep              VARCHAR,
          logradouro       VARCHAR,
          numero           VARCHAR,
          complemento      VARCHAR,
          bairro           VARCHAR,
          cidade           VARCHAR,
          estado_uf        VARCHAR(2),
          pais             VARCHAR NOT NULL DEFAULT 'Brasil',
          foto_url         VARCHAR,
          eh_aluno         BOOLEAN NOT NULL DEFAULT FALSE,
          ativo            BOOLEAN NOT NULL DEFAULT TRUE,
          created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await this.dataSource.query(`
        ALTER TABLE projeto_inscricoes
          ADD COLUMN IF NOT EXISTS responsavel_id UUID REFERENCES responsaveis(id)
      `);
      this.logger.log('✅ tabela responsaveis criada e responsavel_id adicionado em projeto_inscricoes');

      // ── View unificada de documentos do aluno (matrículas + projetos) ────
      // Read-through: acadêmico lê esta view; documentos enviados no projeto de
      // um aluno ITP passam a refletir no acadêmico, e vice-versa. Fonte única
      // por documento → exclusão reflete automaticamente (sem cópia de arquivo).
      // Tipos do projeto são mapeados para o vocabulário canônico das matrículas.
      await this.dataSource.query(`
        CREATE OR REPLACE VIEW documentos_aluno_unificado AS
        SELECT
          COALESCE(i.aluno_id, a.id)::text AS aluno_id,
          di.tipo                          AS tipo,
          di.url_arquivo                   AS url_arquivo,
          di.mimetype                      AS mimetype,
          di.tamanho_bytes                 AS tamanho_bytes,
          'matriculas'::text               AS source,
          di.created_at                    AS created_at
        FROM documentos_inscricao di
        JOIN inscricoes i ON i.id = di.inscricao_id
        LEFT JOIN alunos a ON a.inscricao_id = di.inscricao_id
        WHERE COALESCE(i.aluno_id, a.id) IS NOT NULL

        UNION ALL

        SELECT
          pi.aluno_id::text                AS aluno_id,
          CASE pid.tipo
            WHEN 'identidade_aluno'   THEN 'identidade'
            WHEN 'declaracao_escolar' THEN 'declaracao_escolaridade'
            ELSE pid.tipo
          END                              AS tipo,
          pid.url_arquivo                  AS url_arquivo,
          NULL::varchar                    AS mimetype,
          pid.tamanho_bytes                AS tamanho_bytes,
          'projetos'::text                 AS source,
          pid.created_at                   AS created_at
        FROM projeto_inscricao_documentos pid
        JOIN projeto_inscricoes pi ON pi.id = pid.inscricao_id
        WHERE pi.aluno_id IS NOT NULL
          AND pid.tipo NOT LIKE 'extra%'
      `);
      this.logger.log('✅ view documentos_aluno_unificado criada (espelhamento matrículas ↔ projetos)');

      // ── v21: FK do financeiro (categoria/plano_contas/tipo_movimentacao/
      // forma_pagamento) — colunas varchar antigas mantidas intactas, FK nova
      // em paralelo. Backfill via nome (case-insensitive), cria a linha na
      // tabela de lookup se ainda não existir. Auditoria de banco 2026-09-08. ─
      await this.dataSource.query(`ALTER TABLE movimentacoes_financeiras ADD COLUMN IF NOT EXISTS categoria_id uuid REFERENCES categorias_financeiras(id)`);
      await this.dataSource.query(`ALTER TABLE movimentacoes_financeiras ADD COLUMN IF NOT EXISTS plano_contas_id uuid REFERENCES planos_contas(id)`);
      await this.dataSource.query(`ALTER TABLE movimentacoes_financeiras ADD COLUMN IF NOT EXISTS tipo_movimentacao_id uuid REFERENCES tipos_movimentacao(id)`);
      await this.dataSource.query(`ALTER TABLE movimentacoes_financeiras ADD COLUMN IF NOT EXISTS forma_pagamento_id uuid REFERENCES formas_pagamento(id)`);

      await this.dataSource.query(`
        INSERT INTO categorias_financeiras (nome)
        SELECT DISTINCT trim(categoria) FROM movimentacoes_financeiras m
        WHERE categoria IS NOT NULL AND trim(categoria) <> ''
          AND NOT EXISTS (SELECT 1 FROM categorias_financeiras cf WHERE LOWER(cf.nome) = LOWER(trim(m.categoria)))
      `);
      await this.dataSource.query(`
        UPDATE movimentacoes_financeiras m SET categoria_id = cf.id
        FROM categorias_financeiras cf
        WHERE m.categoria_id IS NULL AND m.categoria IS NOT NULL AND LOWER(cf.nome) = LOWER(trim(m.categoria))
      `);

      await this.dataSource.query(`
        INSERT INTO planos_contas (nome)
        SELECT DISTINCT trim(plano_contas) FROM movimentacoes_financeiras m
        WHERE plano_contas IS NOT NULL AND trim(plano_contas) <> ''
          AND NOT EXISTS (SELECT 1 FROM planos_contas pc WHERE LOWER(pc.nome) = LOWER(trim(m.plano_contas)))
      `);
      await this.dataSource.query(`
        UPDATE movimentacoes_financeiras m SET plano_contas_id = pc.id
        FROM planos_contas pc
        WHERE m.plano_contas_id IS NULL AND m.plano_contas IS NOT NULL AND LOWER(pc.nome) = LOWER(trim(m.plano_contas))
      `);

      await this.dataSource.query(`
        INSERT INTO tipos_movimentacao (nome)
        SELECT DISTINCT trim(tipo_movimentacao) FROM movimentacoes_financeiras m
        WHERE tipo_movimentacao IS NOT NULL AND trim(tipo_movimentacao) <> ''
          AND NOT EXISTS (SELECT 1 FROM tipos_movimentacao tm WHERE LOWER(tm.nome) = LOWER(trim(m.tipo_movimentacao)))
      `);
      await this.dataSource.query(`
        UPDATE movimentacoes_financeiras m SET tipo_movimentacao_id = tm.id
        FROM tipos_movimentacao tm
        WHERE m.tipo_movimentacao_id IS NULL AND m.tipo_movimentacao IS NOT NULL AND LOWER(tm.nome) = LOWER(trim(m.tipo_movimentacao))
      `);

      await this.dataSource.query(`
        INSERT INTO formas_pagamento (nome)
        SELECT DISTINCT trim(forma_pagamento) FROM movimentacoes_financeiras m
        WHERE forma_pagamento IS NOT NULL AND trim(forma_pagamento) <> ''
          AND NOT EXISTS (SELECT 1 FROM formas_pagamento fp WHERE LOWER(fp.nome) = LOWER(trim(m.forma_pagamento)))
      `);
      await this.dataSource.query(`
        UPDATE movimentacoes_financeiras m SET forma_pagamento_id = fp.id
        FROM formas_pagamento fp
        WHERE m.forma_pagamento_id IS NULL AND m.forma_pagamento IS NOT NULL AND LOWER(fp.nome) = LOWER(trim(m.forma_pagamento))
      `);

      await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_movfin_categoria_id ON movimentacoes_financeiras(categoria_id)`);
      await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_movfin_plano_contas_id ON movimentacoes_financeiras(plano_contas_id)`);
      await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_movfin_tipo_movimentacao_id ON movimentacoes_financeiras(tipo_movimentacao_id)`);
      await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_movfin_forma_pagamento_id ON movimentacoes_financeiras(forma_pagamento_id)`);
      this.logger.log('✅ v21: FK financeiro criada e backfillada (categoria/plano_contas/tipo_movimentacao/forma_pagamento)');

      // ── v22: soft delete em tabelas criticas (alunos, usuarios,
      // movimentacoes_financeiras, inscricoes, boletos) — exclusao vira
      // reversivel/auditavel em vez de hard delete. Auditoria de banco
      // 2026-09-08, item P0 #4. Indice parcial (WHERE deleted_at IS NULL)
      // pra nao pagar custo de index em linha excluida, e acelerar o filtro
      // que os services passam a aplicar em toda listagem. ──────────────
      await this.dataSource.query(`ALTER TABLE alunos ADD COLUMN IF NOT EXISTS deleted_at timestamptz`);
      await this.dataSource.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS deleted_at timestamptz`);
      await this.dataSource.query(`ALTER TABLE movimentacoes_financeiras ADD COLUMN IF NOT EXISTS deleted_at timestamptz`);
      await this.dataSource.query(`ALTER TABLE inscricoes ADD COLUMN IF NOT EXISTS deleted_at timestamptz`);
      await this.dataSource.query(`ALTER TABLE boletos ADD COLUMN IF NOT EXISTS deleted_at timestamptz`);
      await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_alunos_deleted_at ON alunos(id) WHERE deleted_at IS NULL`);
      await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_usuarios_deleted_at ON usuarios(id) WHERE deleted_at IS NULL`);
      await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_movfin_deleted_at ON movimentacoes_financeiras(id) WHERE deleted_at IS NULL`);
      await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_inscricoes_deleted_at ON inscricoes(id) WHERE deleted_at IS NULL`);
      await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_boletos_deleted_at ON boletos(id) WHERE deleted_at IS NULL`);
      this.logger.log('✅ v22: soft delete (deleted_at) em alunos/usuarios/movimentacoes_financeiras/inscricoes/boletos');

      // ── v23: alergias_descricao/medicamentos_descricao em alunos/inscricoes
      // — campos já existiam em funcionarios/professores mas nunca foram
      // migrados pra alunos/inscricoes, apesar de CAMPOS_ALUNO (matriculas.
      // service.ts) já tentar sincronizá-los, causando "column does not
      // exist" em produção. ──────────────────────────────────────────────
      await this.dataSource.query(`ALTER TABLE alunos ADD COLUMN IF NOT EXISTS alergias_descricao TEXT`);
      await this.dataSource.query(`ALTER TABLE alunos ADD COLUMN IF NOT EXISTS medicamentos_descricao TEXT`);
      await this.dataSource.query(`ALTER TABLE inscricoes ADD COLUMN IF NOT EXISTS alergias_descricao TEXT`);
      await this.dataSource.query(`ALTER TABLE inscricoes ADD COLUMN IF NOT EXISTS medicamentos_descricao TEXT`);
      this.logger.log('✅ v23: alergias_descricao/medicamentos_descricao em alunos/inscricoes');

      // ── v24: índices de FK ausentes + CHECK/enum (auditoria de banco,
      // P1) — aplicados direto via psql em produção em 2026-09-11, mas
      // isso não seria recriado num banco novo/restaurado do zero
      // (homologação futura, disaster recovery). Promovido pra cá pra
      // fechar essa dívida. Enums derivados do código-fonte real (não só
      // dos dados vistos em produção), pra não bloquear valor válido
      // ainda sem uso (ex: role=cozinha existe no ROLE_LEVEL do backend
      // mas não tinha nenhum usuário com esse role em produção). ───────
      const fksParaIndexar: [string, string][] = [
        ['alunos', 'inscricao_id'], ['boleto_parcelas', 'boleto_id'],
        ['diario_academico', 'aluno_id'], ['diario_academico', 'turma_id'],
        ['diario_academico', 'usuario_id'], ['inscricoes', 'aluno_id'],
        ['projeto_inscricoes', 'equipe_id'], ['projeto_inscricoes', 'projeto_id'],
        ['projeto_inscricoes', 'responsavel_id'], ['estoque_movimentos', 'produto_id'],
        ['gente_colaborador_codigos', 'codigo_id'], ['gente_colaborador_locais', 'colaborador_id'],
        ['gente_folga_solicitacoes', 'colaborador_id'], ['gente_recibos', 'movimentacao_id'],
        ['gente_trabalho_externo', 'colaborador_id'], ['grade_horaria', 'materia_id'],
        ['inscricao_anotacoes', 'inscricao_id'], ['inscricao_movimentacoes', 'inscricao_id'],
        ['materias', 'professor_id'], ['movimentacoes_financeiras', 'doador_id'],
        ['pesquisas_respostas', 'pesquisa_id'], ['projeto_equipes', 'projeto_id'],
        ['projeto_presencas', 'equipe_id'], ['projeto_presencas', 'projeto_id'],
        ['turma_alunos', 'turma_id'], ['turmas', 'curso_id'], ['usuarios', 'grupo_id'],
      ];
      for (const [tabela, coluna] of fksParaIndexar) {
        await this.dataSource.query(
          `CREATE INDEX IF NOT EXISTS idx_${tabela}_${coluna} ON ${tabela}(${coluna})`,
        );
      }
      const checksParaCriar: [string, string, string][] = [
        ['usuarios', 'chk_usuarios_role',
          `role IN ('user','cozinha','assist','monitor','prof','adjunto','drt','vp','prt','admin')`],
        ['movimentacoes_financeiras', 'chk_movfin_status',
          `status IN ('Pendente','Pago','Confirmado','Cancelado','Concluído')`],
        ['boletos', 'chk_boletos_status', `status IN ('Pendente','Pago')`],
        ['chamados_academicos', 'chk_chamados_status', `status IN ('aberto','em_andamento','resolvido')`],
      ];
      for (const [tabela, nome, condicao] of checksParaCriar) {
        await this.dataSource.query(`
          DO $$ BEGIN
            ALTER TABLE ${tabela} ADD CONSTRAINT ${nome} CHECK (${condicao});
          EXCEPTION WHEN duplicate_object THEN NULL;
          END $$;
        `);
      }
      this.logger.log('✅ v24: índices de FK ausentes + CHECK/enum (usuarios.role, movimentacoes_financeiras/boletos/chamados_academicos.status)');

      // ── v25: updated_at/created_at faltando (auditoria de banco, P2,
      // parte aditiva — não renomeia/remove nenhuma coluna existente,
      // só adiciona o que faltava em 17 tabelas). ───────────────────────
      const tabelasSemUpdatedAt = [
        'chamados_acompanhamentos', 'chamados_filas', 'diario_academico',
        'estoque_categorias', 'estoque_movimentos', 'gente_colaborador_codigos',
        'gente_colaborador_locais', 'gente_feriados', 'gente_pagamentos_passagem',
        'inscricao_anotacoes', 'inscricao_movimentacoes', 'pesquisas_respostas',
        'presenca_sessoes', 'projeto_presencas', 'turma_alunos', 'turmas',
      ];
      for (const tabela of tabelasSemUpdatedAt) {
        await this.dataSource.query(
          `ALTER TABLE ${tabela} ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
        );
      }
      await this.dataSource.query(
        `ALTER TABLE config_listas ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
      );
      this.logger.log('✅ v25: updated_at em 16 tabelas + created_at em config_listas');

      // ── v26: unifica nomenclatura camelCase → snake_case em 5 tabelas
      // (auditoria de banco, P2) — alunos, alunos_complemento, materias,
      // estoque_produtos, documentos_validacao usavam "createdAt"/
      // "updatedAt" (camelCase, colunas quotadas) enquanto o resto do
      // schema usa created_at/updated_at. Entities atualizadas junto
      // (@CreateDateColumn({ name: 'created_at' }) etc.) e toda query SQL
      // crua que referenciava essas colunas nessas 5 tabelas também foi
      // corrigida (academico.service.ts). RENAME COLUMN não tem IF NOT
      // EXISTS nativo no Postgres — guard manual via information_schema.
      const renomeacoesV26: [string, string, string][] = [
        ['alunos', 'createdAt', 'created_at'], ['alunos', 'updatedAt', 'updated_at'],
        ['alunos_complemento', 'createdAt', 'created_at'], ['alunos_complemento', 'updatedAt', 'updated_at'],
        ['materias', 'createdAt', 'created_at'], ['materias', 'updatedAt', 'updated_at'],
        ['estoque_produtos', 'createdAt', 'created_at'], ['estoque_produtos', 'updatedAt', 'updated_at'],
        ['documentos_validacao', 'createdAt', 'created_at'], ['documentos_validacao', 'updatedAt', 'updated_at'],
      ];
      for (const [tabela, de, para] of renomeacoesV26) {
        await this.dataSource.query(`
          DO $$ BEGIN
            IF EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_name = '${tabela}' AND column_name = '${de}'
            ) THEN
              EXECUTE 'ALTER TABLE ${tabela} RENAME COLUMN "${de}" TO ${para}';
            END IF;
          END $$;
        `);
      }
      this.logger.log('✅ v26: nomenclatura unificada pra snake_case em alunos/alunos_complemento/materias/estoque_produtos/documentos_validacao');

      // ── Marca schema como atualizado — próximos cold starts pulam tudo ────
      await this.dataSource.query(`UPDATE _schema_version SET version = $1, ran_at = now() WHERE id = 1`, [SCHEMA_VERSION]);
      this.logger.log(`✅ Schema v${SCHEMA_VERSION} aplicado e registrado`);

    } catch (err: any) {
      this.logger.error(`❌ Erro nas migrations automáticas: ${err.message}`);
    }
  }
}