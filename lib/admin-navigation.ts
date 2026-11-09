/** Atalhos REAIS do console do proprietário. Sem links fictícios ou outra sidebar. */
export type ConsoleLink = { label: string; description: string; href: string };
export type ConsoleGroup = { label: string; links: readonly ConsoleLink[] };

export const CONSOLE_GROUPS: readonly ConsoleGroup[] = [
  {
    label: 'Operação',
    links: [
      { label: 'Clientes', description: 'Carteira, contratos e situação atual', href: '#clientes' },
      { label: 'Coleta e monitoramento', description: 'Acompanhar fontes e publicações', href: '/vigia' },
      { label: 'Fontes e credenciais', description: 'Conectores e configurações', href: '/impostazioni/fonti' },
    ],
  },
  {
    label: 'Inteligência',
    links: [
      { label: 'Provedores de IA', description: 'Modelos, escopo e disponibilidade', href: '#ia' },
      { label: 'Alertas', description: 'Ocorrências que exigem atenção', href: '/alerts' },
      { label: 'Relatórios', description: 'Consolidação e exportação', href: '/report' },
    ],
  },
  {
    label: 'Administração',
    links: [
      { label: 'Planos e faturamento', description: 'Indicadores contratuais e cobrança', href: '#financeiro' },
      { label: 'Usuários e acessos', description: 'Equipe e permissões', href: '/impostazioni/team' },
      { label: 'Projetos', description: 'Termos, idiomas e entidades', href: '/settings' },
      { label: 'Integrações MCP', description: 'Conectividade e tokens', href: '/mcp' },
    ],
  },
];
