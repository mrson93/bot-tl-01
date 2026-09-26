import {infoPage} from './_site.js';

export function onRequestGet() {
  return infoPage({slug:'contato',title:'Fale com o Tá Barato',eyebrow:'CONTATO',
    description:'Canais oficiais para acompanhar ofertas ou falar com o Tá Barato.',
    content:`<h2>E-mail editorial e administrativo</h2><p>Para correções, sugestões de pauta, dúvidas sobre o site ou questões administrativas, escreva para <a href="mailto:canaltabarato22@gmail.com">canaltabarato22@gmail.com</a>.</p><h2>Canal oficial</h2><p>Para acompanhar as ofertas em tempo real, entre no <a href="https://t.me/CanalTaBarato" rel="noopener noreferrer">canal Tá Barato no Telegram ↗</a>.</p><h2>Correção de conteúdo</h2><p>Se encontrar uma especificação incorreta em uma matéria, informe o título da página, o trecho e, quando possível, a fonte oficial. A correção será analisada e a data de atualização ficará visível no artigo.</p><h2>Sobre uma oferta</h2><p>Se o preço mudou ou o produto acabou, abra a página da oferta e use o botão de aviso. Isso sinaliza o item para revisão; a disponibilidade é confirmada pela consulta oficial do catálogo.</p><h2>Redes</h2><p>Você também pode acompanhar o perfil <a href="https://bsky.app/profile/canaltabarato.com.br" rel="noopener noreferrer">@canaltabarato.com.br no Bluesky ↗</a>.</p>`});
}
