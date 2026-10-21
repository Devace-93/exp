import type { PartialCatalog } from "./en";

/** Português (Portugal) — overrides vs the Brazilian base. */
const ptPT: PartialCatalog = {
  "nav.login": "Iniciar sessão",
  "nav.signup": "Registe-se grátis",
  "nav.logout": "Terminar sessão",
  "nav.billing": "Faturação",
  "ui.search": "Pesquisar",

  "landing.heroBody":
    "O exp dá a cada projeto os seus próprios ambientes e flags: ative, lance para uma percentagem ou sirva valores tipados. Leia tudo da sua app com um único pedido e faça a gestão pelo painel, pela API REST ou por um servidor MCP.",
  "landing.step2Body":
    "Flags booleanas, de texto, numéricas ou JSON. Defina ativação, valor e percentagem de rollout por ambiente.",
  "landing.step3Body":
    "Um GET com a chave do ambiente devolve todas as flags resolvidas para um utilizador. Rollouts determinísticos, sem SDK.",
  "landing.evalBody":
    "Sem SDK, sem biblioteca de polling: a sua app envia a chave de cliente do ambiente e um distinct_id opcional, e recebe todas as flags já resolvidas. Os rollouts fazem hash da chave da flag e do id do utilizador, por isso o mesmo utilizador cai sempre do mesmo lado.",
  "landing.evalPanelRequest": "Pedido",
  "landing.mcpBullet1Title": "Chaves restritas por função.",
  "landing.mcpBullet3Title": "Registo de auditoria.",
  "landing.mcpBullet3Body": "Toda a alteração e toda a chamada recusada fica registada, no servidor e no agente.",
  "landing.mcpKeyNote": "Crie uma chave com a função que quiser em",
  "landing.selfhostBody2": ". Sem código de faturação, sem limites além dos que configurar.",
  "landing.ctaBody": "Crie um projeto, obtenha uma chave de ambiente e avalie a sua primeira flag em menos de cinco minutos.",

  "pricing.footnote":
    "Todos os preços em USD. A faturação anual poupa ~20%. As quantidades de projetos, ambientes, flags e chaves são limites rígidos; avaliações acima do orçamento mensal continuam a ser servidas: apenas reportamos o excedente.",
  "pricing.user": "utilizador",
  "pricing.users": "utilizadores",
  "pricing.teamExtras": "Funções + suporte prioritário",
  "pricing.contactUs": "Contacte-nos",
  "pricing.enterpriseBody": "Os planos Enterprise são feitos à medida da sua equipa.",

  "docs.authApiKey":
    "API de gestão: chaves de API com uma função (viewer / editor / admin). Cabeçalho X-API-Key: exp_live_… (ou Authorization: Bearer).",
  "docs.evalRule2":
    "rollout_percent < 100: bucket = os primeiros 8 caracteres hex de sha256(\"<flag_key>:<distinct_id>\") como inteiro, módulo 100. Dentro quando bucket < rollout_percent. Sem distinct_id o pedido fica fora, a menos que rollout_percent == 100.",
  "docs.mcpBody":
    "O servidor MCP expõe a API de gestão como ferramentas, filtradas pela função da chave com que se liga. Ferramentas destrutivas pedem confirmação.",
  "sponsors.become": "Torne-se supporter",

  "common.loading": "A carregar…",
  "common.creating": "A criar…",
  "common.saving": "A guardar…",
  "common.save": "Guardar",
  "common.saved": "Guardado.",
  "common.delete": "Eliminar",
  "common.deleting": "A eliminar…",
  "common.password": "Palavra-passe",
  "common.role": "Função",
  "common.retry": "Tentar novamente",

  "limit.projects": "Atingiu o limite de projetos do seu plano.",
  "limit.environments": "Atingiu o limite de ambientes por projeto do seu plano.",
  "limit.flags": "Atingiu o limite de flags por projeto do seu plano.",
  "limit.api_keys": "Atingiu o limite de chaves de API do seu plano.",
  "limit.generic": "Atingiu um limite do seu plano.",

  "dash.usageEvaluations": "Avaliações neste período",
  "dash.searchPlaceholder": "Pesquisar projetos…",
  "dash.empty": "Nenhum projeto ainda. Crie o primeiro para obter três ambientes e as suas chaves de cliente.",
  "dash.noMatch": "Nenhum projeto corresponde à sua pesquisa.",
  "dash.keysWarning": "Copie estas chaves agora: são mostradas só uma vez. Pode rodar uma chave mais tarde nas definições do projeto.",

  "project.settings": "Definições",
  "project.searchPlaceholder": "Pesquisar flags…",
  "project.noMatch": "Nenhuma flag corresponde à sua pesquisa.",
  "project.flagKeyHint": "Letras minúsculas, dígitos, hífenes e underscores. Não pode ser alterada depois.",
  "project.createFailed": "Não foi possível criar a flag.",

  "copy.skip": "Saltar",
  "copy.running": "A copiar…",
  "copy.skipped": "Saltadas: {n}",

  "flag.rolloutHint": "Os utilizadores são distribuídos por sha256(flag_key:distinct_id). Abaixo de 100%, pedidos sem distinct_id ficam fora.",
  "flag.previewTitle": "Pré-visualização da avaliação",
  "flag.runPreview": "Pré-visualizar",
  "flag.previewFailed": "A pré-visualização falhou.",
  "flag.deleteTitle": "Eliminar esta flag",
  "flag.deleteBody": "Elimina a flag e todos os seus estados por ambiente. As apps que a avaliam deixarão de a ver. Considere arquivá-la em vez disso.",
  "flag.deleteFailed": "Não foi possível eliminar a flag.",
  "flag.deleteButton": "Eliminar flag",

  "psettings.title": "Definições do projeto",
  "psettings.loadFailed": "Falha ao carregar as definições do projeto.",
  "psettings.rotate": "Rodar chave",
  "psettings.rotateConfirm": "Rodar a chave de cliente de {env}? A chave antiga deixa de funcionar imediatamente.",
  "psettings.rotateFailed": "Não foi possível rodar a chave.",
  "psettings.oneTimeKey": "Copie esta chave de cliente agora: não voltará a ser mostrada.",
  "psettings.deleteEnv": "Eliminar",
  "psettings.deleteEnvConfirm": "Eliminar o ambiente {env} e todos os estados de flags nele?",
  "psettings.deleteEnvFailed": "Não foi possível eliminar o ambiente.",
  "psettings.lastEnv": "O último ambiente não pode ser eliminado.",
  "psettings.download": "Transferir JSON",
  "psettings.exportBody": "Transfira o projeto (ambientes, flags e estados) como JSON (formato exp.project.v1).",
  "psettings.dangerBody": "Eliminar o projeto remove os seus ambientes, flags e estados. Não pode ser anulado.",
  "psettings.deleteProject": "Eliminar projeto",
  "psettings.deleteProjectFailed": "Não foi possível eliminar o projeto.",

  "keys.unavailableBody": "Estamos a disponibilizar aos poucos. Volte em breve.",
  "keys.copyNow": "Copie a sua nova chave agora: não voltará a ser mostrada.",
  "keys.revokeConfirm": "Revogar esta chave? Tudo o que a usa deixa de funcionar imediatamente.",

  "audit.title": "Registo de auditoria",
  "audit.loadFailed": "Falha ao carregar o registo de auditoria.",

  "billing.title": "Faturação",
  "billing.selfHostDisabled": "A faturação está desativada",
  "billing.earlyTitle": "Está em acesso antecipado: tudo incluído, grátis.",
  "billing.earlyBody": "Ainda não há nada para comprar. Planos e limites serão introduzidos depois, e será avisado antes de qualquer mudança.",
  "billing.unavailableBody": "Estamos a disponibilizar a faturação aos poucos. Mantém tudo do seu plano atual. Volte em breve.",
  "billing.onPlanPrefix": "Está no plano",
  "billing.annualSave": "(poupe ~20%)",
  "billing.featUsers": "{n} utilizadores",
  "billing.processing": "A processar…",
  "billing.notConfigured":
    "A faturação ainda não está configurada (falta VITE_REVENUECAT_PUBLIC_KEY). Adicione a sua chave pública do RevenueCat Web Billing ao .env e reconstrua a imagem web.",
  "billing.signInAgain": "Inicie sessão novamente para fazer upgrade.",
  "billing.openingCheckout": "A abrir o checkout seguro…",
  "billing.activating": "Pagamento concluído. A ativar o seu plano…",
  "billing.nowOnPlan": "Está agora no plano {plan}! 🎉",
  "billing.willUpdate": "Pagamento recebido. O seu plano será atualizado em instantes.",
};
export default ptPT;
