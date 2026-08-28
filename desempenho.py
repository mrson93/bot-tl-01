"""Classificacao simples e agregacoes comerciais sem dados de compradores."""
import re
import unicodedata


_PALAVRAS_FRACAS = {
    "a", "as", "com", "da", "das", "de", "do", "dos", "e", "em", "para",
    "por", "um", "uma", "kit", "novo", "original", "produto", "oferta",
}


_REGRAS = (
    ("hidratacao", (
     "Pra bebida continuar na temperatura certa por mais tempo 💧",
     "Uma companhia prática para a rotina de hidratação 💧",
     "Pra ter água por perto do jeito que você gosta 💧",
     "Boa pedida para levar bebida gelada ou quente por mais tempo 💧",
     "Um item simples que faz diferença ao longo do dia 💧",
     "Pra manter sua bebida pronta entre um compromisso e outro 💧",
     "Hidratação mais prática para casa, trabalho ou passeio 💧",
     "Pra não depender de bebida morna no meio do caminho 💧",
     "Uma escolha útil para quem lembra de beber mais água 💧",
     "Pra acompanhar a rotina sem abrir mão da bebida na temperatura certa 💧",
    ),
     ("garrafa termica", "copo termico", "squeeze", "caneca termica")),
    ("cozinha", (
     "Um achado pra facilitar a rotina na cozinha 🍳",
     "Pra deixar o preparo das refeições mais prático 🍳",
     "Uma ajuda bem-vinda para quem gosta de cozinha organizada 🍳",
     "Daqueles itens que tornam a rotina na cozinha mais leve 🍳",
     "Pra ganhar tempo na hora de preparar ou guardar a comida 🍳",
     "Uma escolha útil para a cozinha do dia a dia 🍳",
     "Pra facilitar desde o café até o jantar 🍳",
     "Bom pra quem adora uma cozinha funcional 🍳",
     "Um detalhe prático que pode salvar o almoço 🍳",
     "Pra deixar cada etapa da cozinha um pouco mais simples 🍳",
    ),
     ("panela", "frigideira", "cozinha", "air fryer", "liquidificador",
      "cafeteira", "garrafa", "copo", "pote", "faca", "talher")),
    ("ferramentas", (
     "Boa pra resolver pequenos reparos sem improviso 🔧",
     "Pra ter uma solução à mão quando algo precisar de ajuste 🔧",
     "Daquelas ferramentas que valem ter em casa 🔧",
     "Boa para deixar a caixa de ferramentas mais completa 🔧",
     "Pra encarar pequenos consertos com mais tranquilidade 🔧",
     "Um reforço prático para reparos do dia a dia 🔧",
     "Pra não ficar na mão quando surgir aquele ajuste rápido 🔧",
     "Item útil para quem gosta de resolver as coisas por conta própria 🔧",
     "Pra facilitar manutenção, montagem e pequenos consertos 🔧",
     "Uma boa escolha para a gaveta de ferramentas 🔧",
    ),
     ("ferramenta", "furadeira", "parafusadeira", "chave", "alicate",
      "serra", "broca", "multimetro", "solda")),
    ("casa", (
     "Pra deixar a casa mais prática e organizada 🏠",
     "Um detalhe que ajuda a deixar o lar mais gostoso 🏠",
     "Pra resolver pequenas necessidades da casa com praticidade 🏠",
     "Boa escolha para quem gosta da casa em ordem 🏠",
     "Pra dar mais conforto à rotina dentro de casa 🏠",
     "Um item funcional para os cantinhos do lar 🏠",
     "Pra organizar, iluminar ou cuidar melhor da casa 🏠",
     "Daqueles achados que facilitam o dia a dia em casa 🏠",
     "Pra deixar cada espaço um pouco mais útil 🏠",
     "Uma ajuda simples para uma casa mais funcional 🏠",
    ),
     ("organizador", "prateleira", "luminaria", "lampada", "cortina",
      "tapete", "almofada", "aspirador", "limpeza", "cama", "banho")),
    ("eletronicos", (
     "Tecnologia útil sem precisar pagar caro ⚡",
     "Um upgrade prático para a rotina digital ⚡",
     "Pra deixar a tecnologia do dia a dia mais redonda ⚡",
     "Boa pedida para quem gosta de praticidade conectada ⚡",
     "Um eletrônico útil para trabalho, estudo ou lazer ⚡",
     "Pra melhorar seu setup sem exagerar no gasto ⚡",
     "Tecnologia que pode facilitar bastante a rotina ⚡",
     "Um achado para quem curte dispositivos que realmente ajudam ⚡",
     "Pra dar uma força na conexão, no som ou na produtividade ⚡",
     "Boa escolha para atualizar um acessório tecnológico ⚡",
    ),
     ("fone", "headset", "teclado", "mouse", "carregador", "cabo",
      "smartwatch", "caixa de som", "bluetooth", "camera", "monitor",
      "echo", "alexa", "smart speaker", "alto falante", "ipad", "tablet")),
    ("beleza", (
     "Um cuidado a mais sem pesar no bolso ✨",
     "Pra reservar um momento de autocuidado na rotina ✨",
     "Um achado para renovar os cuidados pessoais ✨",
     "Pra se cuidar com praticidade todos os dias ✨",
     "Boa pedida para dar atenção à pele, cabelo ou visual ✨",
     "Um detalhe de beleza que cabe na rotina ✨",
     "Pra deixar o autocuidado ainda mais acessível ✨",
     "Uma escolha útil para seu ritual de cuidados ✨",
     "Pra adicionar um toque de cuidado ao dia ✨",
     "Um mimo para quem gosta de se sentir bem ✨",
    ),
     ("perfume", "maquiagem", "batom", "creme", "serum", "shampoo",
      "secador", "escova", "barbeador", "beleza", "skincare")),
    ("pet", (
     "Um mimo útil pro seu companheiro de quatro patas 🐾",
     "Pra deixar a rotina do seu pet mais confortável 🐾",
     "Um cuidado prático para quem faz parte da família 🐾",
     "Boa escolha para facilitar os dias com seu bichinho 🐾",
     "Pra demonstrar carinho com algo que realmente ajuda 🐾",
     "Um achado para o bem-estar do seu pet 🐾",
     "Pra cuidar do companheiro de quatro patas com praticidade 🐾",
     "Um item útil para a casa de quem ama animais 🐾",
     "Pra deixar a rotina do pet mais organizada e gostosa 🐾",
     "Um reforço de cuidado para o seu melhor amigo 🐾",
    ),
     ("pet", "cachorro", "gato", "racao", "coleira", "comedouro",
      "arranhador", "areia")),
    ("infantil", (
     "Uma opção prática para a rotina com os pequenos 🧸",
     "Pra deixar os momentos das crianças ainda mais fáceis 🧸",
     "Um achado útil para a fase dos pequenos 🧸",
     "Boa escolha para acompanhar a rotina infantil 🧸",
     "Pra trazer mais praticidade aos cuidados e brincadeiras 🧸",
     "Um item pensado para facilitar o dia a dia em família 🧸",
     "Pra cuidar, entreter ou organizar a rotina das crianças 🧸",
     "Uma opção que pode ajudar bastante quem tem pequenos em casa 🧸",
     "Pra deixar a fase infantil mais leve e prática 🧸",
     "Um achado carinhoso para a rotina com crianças 🧸",
    ),
     ("bebe", "infantil", "crianca", "brinquedo", "fralda", "mamadeira",
      "carrinho", "boneca")),
    ("automotivo", (
     "Boa pra deixar no carro e usar quando precisar 🚗",
     "Um item prático para quem vive na rua ou na estrada 🚗",
     "Pra deixar o carro mais preparado para a rotina 🚗",
     "Boa escolha para ter mais praticidade ao dirigir 🚗",
     "Um reforço útil para os cuidados com o veículo 🚗",
     "Pra resolver necessidades do carro sem complicação 🚗",
     "Daqueles acessórios que é bom ter sempre por perto 🚗",
     "Pra deixar cada trajeto um pouco mais tranquilo 🚗",
     "Um achado para quem gosta de carro bem cuidado 🚗",
     "Pra equipar o veículo com algo que pode fazer falta 🚗",
    ),
     ("automotivo", "carro", "moto", "veicular", "pneu", "capacete",
      "suporte celular", "compressor")),
    ("esporte", (
     "Pra treinar com mais conforto e gastar menos 🏃",
     "Um incentivo a mais para colocar o corpo em movimento 🏃",
     "Pra deixar o treino mais prático e agradável 🏃",
     "Boa pedida para quem não abre mão da atividade física 🏃",
     "Um achado para acompanhar sua rotina de movimento 🏃",
     "Pra dar mais conforto à academia, corrida ou pedal 🏃",
     "Uma escolha útil para quem busca mais disposição 🏃",
     "Pra levar o treino a sério sem gastar além da conta 🏃",
     "Um item para deixar a atividade física mais gostosa 🏃",
     "Pra acompanhar seus objetivos de saúde e movimento 🏃",
    ),
     ("academia", "fitness", "esporte", "halter", "corrida", "bicicleta",
      "tenis", "mochila")),
    ("moda", (
     "Uma peça versátil pra renovar o visual sem exagerar 💫",
     "Pra dar uma atualizada no guarda-roupa com praticidade 💫",
     "Um achado para montar looks do dia a dia 💫",
     "Boa escolha para quem gosta de se vestir bem sem complicar 💫",
     "Pra renovar o visual com algo fácil de combinar 💫",
     "Uma peça para acompanhar diferentes momentos da rotina 💫",
     "Pra adicionar estilo sem pesar no orçamento 💫",
     "Um item versátil para deixar os looks mais interessantes 💫",
     "Pra encontrar conforto e estilo na mesma escolha 💫",
     "Uma opção prática para variar o visual 💫",
    ),
     ("camisa", "camiseta", "vestido", "calca", "short", "jaqueta",
      "bolsa", "sandalia", "sapato", "moda")),
)


def _normalizar(texto) -> str:
    base = unicodedata.normalize("NFKD", str(texto or ""))
    base = "".join(c for c in base if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", " ", base).strip()


def _contem_termo(texto: str, termo: str) -> bool:
    """Reconhece palavras/expressões completas, sem achar 'ração' em 'geração'."""
    termo = _normalizar(termo)
    padrao = rf"(?<![a-z0-9]){re.escape(termo)}s?(?![a-z0-9])"
    return re.search(padrao, texto) is not None


def categoria_produto(produto) -> str:
    """Classifica por titulo; recebe um texto ou o dicionario da oferta."""
    if isinstance(produto, dict):
        texto = produto.get("categoria") or produto.get("productName")
    else:
        texto = produto
    normalizado = _normalizar(texto)
    for categoria, _, palavras in _REGRAS:
        if any(_contem_termo(normalizado, palavra) for palavra in palavras):
            return categoria
    return "outros"


def chamadas_categoria(categoria: str) -> tuple:
    """Frases aprovadas para uma categoria, sem inventar contexto de produto."""
    for nome, frases, _ in _REGRAS:
        if nome == categoria:
            return frases
    return ()


def chamada_humana(oferta: dict) -> str:
    categoria = categoria_produto(oferta)
    frases = chamadas_categoria(categoria)
    if not frases:
        return ""
    if isinstance(oferta, dict):
        chave = oferta.get("oferta_id") or oferta.get("productName") or oferta.get("titulo")
    else:
        chave = oferta
    # Escolha estável: o mesmo produto não muda de frase a cada nova tentativa,
    # mas produtos diferentes naturalmente variam a chamada publicada.
    indice = sum((posicao + 1) * ord(letra) for posicao, letra in enumerate(str(chave or categoria)))
    return frases[indice % len(frases)]


def tokens_produto(produto) -> set:
    """Palavras úteis para detectar títulos que anunciam essencialmente o mesmo item."""
    if isinstance(produto, dict):
        produto = produto.get("productName") or produto.get("titulo")
    palavras = re.findall(r"[a-z0-9]+", _normalizar(produto))
    return {p for p in palavras if len(p) >= 3 and p not in _PALAVRAS_FRACAS}


def similaridade_produtos(a, b) -> float:
    esquerda, direita = tokens_produto(a), tokens_produto(b)
    if not esquerda or not direita:
        return 0.0
    return len(esquerda & direita) / len(esquerda | direita)


def produtos_semelhantes(a, b, limite=0.55) -> bool:
    return similaridade_produtos(a, b) >= float(limite)


def faixa_preco(valor) -> str:
    try:
        preco = float(valor)
    except (TypeError, ValueError):
        return "nao_informado"
    if preco < 50:
        return "ate R$ 50"
    if preco < 150:
        return "R$ 50 a R$ 150"
    return "acima de R$ 150"


def faixa_desconto(valor) -> str:
    try:
        desconto = float(valor)
    except (TypeError, ValueError):
        return "nao_informado"
    if desconto < 40:
        return "ate 39%"
    if desconto < 70:
        return "40% a 69%"
    return "70% ou mais"


def somar(contadores: dict, chave, quantidade=1) -> None:
    chave = str(chave or "nao_informado")
    contadores[chave] = contadores.get(chave, 0) + int(quantidade or 0)
