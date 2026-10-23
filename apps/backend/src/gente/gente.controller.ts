import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, UseGuards, Request, BadRequestException,
} from '@nestjs/common';

import { GenteService } from './gente.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ModuloPermGuard } from '../auth/guards/modulo-perm.guard';
import { ModuloPerm } from '../auth/decorators/modulo-perm.decorator';
import { Public } from '../auth/decorators/public.decorator';

// Query/body podem chegar como array (?mes_referencia=a&mes_referencia=b); o service espera 'YYYY-MM'.
function mesReferencia(valor: unknown): string {
  if (typeof valor !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(valor)) {
    throw new BadRequestException('mes_referencia deve estar no formato AAAA-MM');
  }
  return valor;
}

@UseGuards(JwtAuthGuard, ModuloPermGuard)
@Controller('gente')
export class GenteController {
  constructor(private readonly svc: GenteService) {}

  // ── Colaboradores ──────────────────────────────────────────────────────────

  @Get('colaboradores')
  @ModuloPerm('gente', 'visualizar')
  listar() { return this.svc.listarColaboradores(); }

  @Get('colaboradores/funcionarios-disponiveis')
  @ModuloPerm('gente', 'visualizar')
  funcionariosDisponiveis() { return this.svc.funcionariosDisponiveis(); }

  @Get('colaboradores/:id')
  @ModuloPerm('gente', 'visualizar')
  buscar(@Param('id') id: string) { return this.svc.buscarColaborador(id); }

  @Get('colaboradores/:id/resumo')
  @ModuloPerm('gente', 'visualizar')
  resumo(@Param('id') id: string) { return this.svc.resumoColaborador(id); }

  @Get('colaboradores/:id/codigos')
  @ModuloPerm('gente', 'visualizar')
  codigosColaborador(@Param('id') id: string) { return this.svc.listarCodigosColaborador(id); }

  @Post('colaboradores')
  @ModuloPerm('gente', 'incluir')
  criar(@Body() dto: any, @Request() req: any) {
    return this.svc.criarColaborador({ ...dto, criado_por_id: req.user?.userId });
  }

  /** Cria funcionário + colaborador em um único passo */
  @Post('colaboradores/novo-funcionario')
  @ModuloPerm('gente', 'incluir')
  criarFuncionario(@Body() body: any, @Request() req: any) {
    const { funcionario, colaborador } = body;
    return this.svc.criarFuncionarioEColaborador(funcionario, colaborador ?? {}, req.user?.userId, );
  }

  @Post('colaboradores/:id/codigos')
  @ModuloPerm('gente', 'incluir')
  atribuirCodigo(@Param('id') id: string, @Body() body: any) {
    return this.svc.atribuirCodigoColaborador(id, body.codigo_id, body.valor_personalizado);
  }

  @Delete('colaborador-codigos/:id')
  @ModuloPerm('gente', 'editar')
  removerCodigoColaborador(@Param('id') id: string) { return this.svc.removerCodigoColaborador(id); }

  @Patch('colaboradores/:id')
  @ModuloPerm('gente', 'editar')
  editar(@Param('id') id: string, @Body() dto: any) { return this.svc.editarColaborador(id, dto); }

  @Patch('colaboradores/:id/funcionario')
  @ModuloPerm('gente', 'editar')
  editarFuncionario(@Param('id') id: string, @Body() dto: any) { return this.svc.editarFuncionarioViaGente(id, dto); }

  @Patch('colaboradores/:id/foto')
  @ModuloPerm('gente', 'editar')
  async uploadFotoColaborador(@Param('id') id: string, @Body() body: { foto: string }) {
    if (!body?.foto) throw new BadRequestException('Nenhuma foto enviada.');
    if (!body.foto.startsWith('data:image/')) throw new BadRequestException('Formato inválido. Envie uma imagem em base64.');
    return this.svc.uploadFotoColaborador(id, body.foto);
  }

  @Delete('colaboradores/:id')
  @ModuloPerm('gente', 'excluir')
  remover(@Param('id') id: string) { return this.svc.removerColaborador(id); }

  // ── Documentos do colaborador ─────────────────────────────────────────────

  @Get('colaboradores/:id/documentos')
  @ModuloPerm('gente', 'visualizar')
  listarDocumentos(@Param('id') id: string) { return this.svc.listarDocumentos(id); }

  @Post('colaboradores/:id/documentos')
  @ModuloPerm('gente', 'editar')
  criarDocumento(@Param('id') id: string, @Body() dto: any, @Request() req: any) {
    return this.svc.criarDocumento({ ...dto, colaborador_id: id, criado_por_id: req.user?.userId, criado_por_nome: req.user?.nome });
  }

  @Patch('documentos/:id')
  @ModuloPerm('gente', 'editar')
  editarDocumento(@Param('id') id: string, @Body() dto: any) { return this.svc.editarDocumento(id, dto); }

  @Delete('documentos/:id')
  @ModuloPerm('gente', 'editar')
  deletarDocumento(@Param('id') id: string) { return this.svc.deletarDocumento(id); }

  // ── Locais permitidos por colaborador ─────────────────────────────────────

  @Get('colaboradores/:id/locais')
  @ModuloPerm('gente', 'visualizar')
  listarLocais(@Param('id') id: string) { return this.svc.listarLocais(id); }

  @Post('colaboradores/:id/locais')
  @ModuloPerm('gente', 'editar')
  criarLocal(@Param('id') id: string, @Body() dto: any) {
    return this.svc.criarLocal({ ...dto, colaborador_id: id });
  }

  @Patch('locais/:id')
  @ModuloPerm('gente', 'editar')
  editarLocal(@Param('id') id: string, @Body() dto: any) { return this.svc.editarLocal(id, dto); }

  @Delete('locais/:id')
  @ModuloPerm('gente', 'excluir')
  deletarLocal(@Param('id') id: string) { return this.svc.deletarLocal(id); }

  // ── Códigos de Ajuda de Custo (VRX) ──────────────────────────────────────

  @Get('codigos-ajuda')
  @ModuloPerm('gente', 'visualizar')
  listarCodigos() { return this.svc.listarCodigos(); }

  @Post('codigos-ajuda')
  @ModuloPerm('gente', 'incluir')
  criarCodigo(@Body() dto: any) { return this.svc.criarCodigo(dto); }

  @Patch('codigos-ajuda/:id')
  @ModuloPerm('gente', 'editar')
  editarCodigo(@Param('id') id: string, @Body() dto: any) { return this.svc.editarCodigo(id, dto); }

  @Delete('codigos-ajuda/:id')
  @ModuloPerm('gente', 'excluir')
  deletarCodigo(@Param('id') id: string) { return this.svc.deletarCodigo(id); }

  // ── Financeiro ────────────────────────────────────────────────────────────

  @Get('financeiro/resumo')
  @ModuloPerm('gente', 'visualizar')
  resumoFinanceiro(@Query('mes') mes?: string) {
    const m = mes || new Date().toISOString().slice(0, 7);
    return this.svc.resumoFinanceiro(m);
  }

  // ── Folha / Recibos ────────────────────────────────────────────────────────

  @Post('folha/calcular')
  @ModuloPerm('gente', 'incluir')
  calcularFolha(@Body() body: any, @Request() req: any) {
    return this.svc.calcularFolha(mesReferencia(body.mes_referencia), req.user?.userId, req.user?.nome ?? 'sistema');
  }

  @Get('folha/preview')
  @ModuloPerm('gente', 'visualizar')
  previewFolha(@Query('colaborador_id') colaborador_id: string, @Query('mes_referencia') mes_referencia: string) {
    return this.svc.previewFolhaColaborador(colaborador_id, mesReferencia(mes_referencia));
  }

  @Post('folha/calcular-um')
  @ModuloPerm('gente', 'incluir')
  calcularFolhaUm(@Body() body: any, @Request() req: any) {
    return this.svc.calcularFolhaColaborador(body.colaborador_id, mesReferencia(body.mes_referencia), req.user?.userId, req.user?.nome ?? 'sistema');
  }

  @Get('recibos')
  @ModuloPerm('gente', 'visualizar')
  listarRecibos(@Query('colaborador_id') colaborador_id?: string, @Query('mes_referencia') mes_referencia?: string) { return this.svc.listarRecibos(colaborador_id, mes_referencia === undefined ? undefined : mesReferencia(mes_referencia)); }

  @Get('recibos/:id/completo')
  @ModuloPerm('gente', 'visualizar')
  reciboCompleto(@Param('id') id: string) { return this.svc.buscarReciboCompleto(id); }

  @Post('recibos')
  @ModuloPerm('gente', 'incluir')
  criarRecibo(@Body() dto: any, @Request() req: any) {
    return this.svc.criarRecibo({ ...dto, criado_por_id: req.user?.userId, criado_por_nome: req.user?.nome });
  }

  @Patch('recibos/:id')
  @ModuloPerm('gente', 'editar')
  editarRecibo(@Param('id') id: string, @Body() dto: any) { return this.svc.editarRecibo(id, dto); }

  @Delete('recibos/:id')
  @ModuloPerm('gente', 'excluir')
  deletarRecibo(@Param('id') id: string) { return this.svc.deletarRecibo(id); }

  // ── Folgas ────────────────────────────────────────────────────────────────

  @Get('folgas')
  @ModuloPerm('gente', 'visualizar')
  listarFolgas(@Query('colaborador_id') c?: string) { return this.svc.listarFolgas(c); }

  @Public()
  @Get('folgas/disponibilidade')
  consultarDisponibilidade(@Query('colaborador_id') colaborador_id: string) {
    return this.svc.consultarDisponibilidadeFolgas(colaborador_id);
  }

  @Public()
  @Post('folgas/solicitar')
  solicitarFolga(@Body() body: any) {
    return this.svc.solicitarFolga(body.colaborador_id, body.data);
  }

  @Post('folgas/admin')
  @ModuloPerm('gente', 'editar')
  criarFolgaAdmin(@Body() body: any, @Request() req: any) {
    return this.svc.criarFolgaAdmin(body.colaborador_id, body.data, req.user?.nome ?? 'admin');
  }

  @Public()
  @Get('folgas/pendentes-confirmacao')
  folgasPendentesConfirmacao(@Query('colaborador_id') colaborador_id: string) {
    return this.svc.folgasPendentesConfirmacao(colaborador_id);
  }

  @Public()
  @Post('folgas/:id/confirmar')
  confirmarRealizacaoFolga(@Param('id') id: string, @Body() body: { realizada: boolean }) {
    return this.svc.confirmarRealizacaoFolga(id, body.realizada);
  }

  @Patch('folgas/:id/responder')
  @ModuloPerm('gente', 'editar')
  responderFolga(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.svc.responderFolga(id, body.status, req.user?.nome ?? 'admin');
  }

  // ── Trabalho externo ──────────────────────────────────────────────────────

  @Get('trabalho-externo')
  @ModuloPerm('gente', 'visualizar')
  listarTrabalhoExterno(@Query('colaborador_id') c?: string) { return this.svc.listarTrabalhoExterno(c); }

  @Post('trabalho-externo')
  @ModuloPerm('gente', 'editar')
  habilitarTrabalhoExterno(@Body() body: any, @Request() req: any) {
    return this.svc.habilitarTrabalhoExterno(body.colaborador_id, body.data, req.user?.nome ?? 'admin', req.user?.userId);
  }

  @Delete('trabalho-externo/:id')
  @ModuloPerm('gente', 'editar')
  revogarTrabalhoExterno(@Param('id') id: string) { return this.svc.revogarTrabalhoExterno(id); }

  // ── Vales ─────────────────────────────────────────────────────────────────

  @Get('vales')
  @ModuloPerm('gente', 'visualizar')
  listarVales(@Query('colaborador_id') c?: string) { return this.svc.listarVales(c); }

  @Post('vales')
  @ModuloPerm('gente', 'incluir')
  criarVale(@Body() dto: any, @Request() req: any) {
    return this.svc.criarVale({ ...dto, criado_por_id: req.user?.userId, criado_por_nome: req.user?.nome });
  }

  @Patch('vales/:id')
  @ModuloPerm('gente', 'editar')
  editarVale(@Param('id') id: string, @Body() dto: any) { return this.svc.editarVale(id, dto); }

  @Delete('vales/:id')
  @ModuloPerm('gente', 'excluir')
  deletarVale(@Param('id') id: string) { return this.svc.deletarVale(id); }

  // ── Advertências ──────────────────────────────────────────────────────────

  @Get('advertencias')
  @ModuloPerm('gente', 'visualizar')
  listarAdvertencias(@Query('colaborador_id') c?: string) { return this.svc.listarAdvertencias(c); }

  @Post('advertencias')
  @ModuloPerm('gente', 'incluir')
  criarAdvertencia(@Body() dto: any, @Request() req: any) {
    return this.svc.criarAdvertencia({ ...dto, criado_por_id: req.user?.userId, criado_por_nome: req.user?.nome });
  }

  @Patch('advertencias/:id')
  @ModuloPerm('gente', 'editar')
  editarAdvertencia(@Param('id') id: string, @Body() dto: any) { return this.svc.editarAdvertencia(id, dto); }

  @Delete('advertencias/:id')
  @ModuloPerm('gente', 'excluir')
  deletarAdvertencia(@Param('id') id: string) { return this.svc.deletarAdvertencia(id); }

  // ── Suspensões ────────────────────────────────────────────────────────────

  @Get('suspensoes')
  @ModuloPerm('gente', 'visualizar')
  listarSuspensoes(@Query('colaborador_id') c?: string) { return this.svc.listarSuspensoes(c); }

  @Post('suspensoes')
  @ModuloPerm('gente', 'incluir')
  criarSuspensao(@Body() dto: any, @Request() req: any) {
    return this.svc.criarSuspensao({ ...dto, criado_por_id: req.user?.userId, criado_por_nome: req.user?.nome });
  }

  @Patch('suspensoes/:id')
  @ModuloPerm('gente', 'editar')
  editarSuspensao(@Param('id') id: string, @Body() dto: any) { return this.svc.editarSuspensao(id, dto); }

  @Delete('suspensoes/:id')
  @ModuloPerm('gente', 'excluir')
  deletarSuspensao(@Param('id') id: string) { return this.svc.deletarSuspensao(id); }

  // ── Faltas ────────────────────────────────────────────────────────────────

  @Get('faltas')
  @ModuloPerm('gente', 'visualizar')
  listarFaltas(@Query('colaborador_id') c?: string) { return this.svc.listarFaltas(c); }

  @Post('faltas')
  @ModuloPerm('gente', 'incluir')
  criarFalta(@Body() dto: any, @Request() req: any) {
    return this.svc.criarFalta({ ...dto, criado_por_id: req.user?.userId, criado_por_nome: req.user?.nome });
  }

  @Patch('faltas/:id')
  @ModuloPerm('gente', 'editar')
  editarFalta(@Param('id') id: string, @Body() dto: any) { return this.svc.editarFalta(id, dto); }

  @Delete('faltas/:id')
  @ModuloPerm('gente', 'excluir')
  deletarFalta(@Param('id') id: string) { return this.svc.deletarFalta(id); }

  // ── Admin: mesclar colaborador duplicado ──────────────────────────────────

  @Post('admin/mesclar-colaborador')
  @ModuloPerm('gente', 'excluir')
  mesclarColaborador(@Body() body: { matricula_correta: string }) {
    if (!body.matricula_correta) throw new BadRequestException('matricula_correta é obrigatória');
    return this.svc.mesclarColaboradorDuplicado(body.matricula_correta);
  }

  // ── Feriados ──────────────────────────────────────────────────────────────

  @Get('feriados')
  @ModuloPerm('gente', 'visualizar')
  listarFeriados(@Query('ano') ano?: string) {
    return this.svc.listarFeriados(ano ? Number(ano) : undefined);
  }

  @Post('feriados')
  @ModuloPerm('gente', 'editar')
  criarFeriado(@Body() dto: any) { return this.svc.criarFeriado(dto); }

  @Delete('feriados/:id')
  @ModuloPerm('gente', 'excluir')
  deletarFeriado(@Param('id') id: string) { return this.svc.deletarFeriado(id); }

  // ── Pagamentos de Passagem ────────────────────────────────────────────────

  @Get('passagens')
  @ModuloPerm('gente', 'visualizar')
  listarPagamentosPassagem(
    @Query('colaborador_id') colaborador_id: string,
    @Query('mes') mes: string,
  ) {
    if (!colaborador_id || !mes) throw new BadRequestException('colaborador_id e mes são obrigatórios');
    return this.svc.listarPagamentosPassagem(colaborador_id, mes);
  }

  @Post('passagens/lote')
  @ModuloPerm('gente', 'incluir')
  salvarPagamentosPassagem(
    @Body() body: { colaborador_id: string; funcionario_id: string; mes: string; dias: { data: string; valor: number; status?: string }[] },
  ) {
    const { colaborador_id, funcionario_id, mes, dias } = body;
    if (!colaborador_id || !funcionario_id || !mes || !Array.isArray(dias)) {
      throw new BadRequestException('Payload inválido');
    }
    return this.svc.salvarPagamentosPassagem(colaborador_id, funcionario_id, mes, dias);
  }

  @Delete('passagens/:id')
  @ModuloPerm('gente', 'excluir')
  removerPagamentoPassagem(@Param('id') id: string) {
    return this.svc.removerPagamentoPassagem(id);
  }

  @Get('passagens/assinaturas')
  @ModuloPerm('gente', 'visualizar')
  listarVtAssinaturas(@Query('mes') mes: string) {
    if (!mes) throw new BadRequestException('mes é obrigatório');
    return this.svc.listarVtAssinaturas(mes);
  }

  @Post('passagens/assinaturas')
  @ModuloPerm('gente', 'incluir')
  toggleVtAssinatura(@Body() body: { colaborador_id: string; mes_referencia: string; assinado: boolean }) {
    const { colaborador_id, mes_referencia, assinado } = body;
    if (!colaborador_id || !mes_referencia || typeof assinado !== 'boolean') {
      throw new BadRequestException('Payload inválido');
    }
    return this.svc.toggleVtAssinatura(colaborador_id, mes_referencia, assinado);
  }
}
