import {infoPage} from './_site.js';

export function onRequestGet(){return infoPage({
  slug:'exclusao-de-dados',
  title:'Exclusão de dados',
  eyebrow:'PRIVACIDADE',
  description:'Como solicitar a exclusão de dados relacionados à automação do Tá Barato no Instagram.',
  content:`<h2>O que é armazenado</h2><p>O Tá Barato não armazena o texto das mensagens, nome, perfil ou identificador da pessoa que responde a um Story. Para impedir respostas duplicadas, mantemos somente um código criptográfico não reversível do evento por até 48 horas.</p><h2>Exclusão automática</h2><p>Esse código é apagado automaticamente em até 48 horas. Como ele não permite identificar a pessoa, não mantemos um cadastro individual que possa ser consultado ou associado ao seu perfil.</p><h2>Alertas no Telegram</h2>
<p>Envie /parar ao bot de alertas para apagar imediatamente suas palavras e o histórico de avisos. Bloquear o bot tem o mesmo efeito no próximo aviso.</p>
<h2>Revogar o acesso</h2><p>Você pode interromper a interação a qualquer momento deixando de responder aos Stories, bloqueando o perfil ou removendo a conversa no Instagram. Para dúvidas sobre privacidade, fale pelo Direct do perfil <a href="https://www.instagram.com/ofertascanaltabarato/" rel="noopener noreferrer">@ofertascanaltabarato ↗</a>.</p><p><small>Última atualização: setembro de 2026.</small></p>`
});}
