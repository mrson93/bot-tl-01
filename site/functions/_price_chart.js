// Gráfico de preço em PNG, desenhado no próprio site (sem serviço de fora).
// Entra só o histórico do produto (dia e menor preço do dia); nada da pessoa.
// PNG de paleta (8 bits) comprimido com CompressionStream('deflate'), que já
// entrega o formato zlib que o PNG pede.

const LARGURA=800, ALTURA=420;
const AREA={x0:160,x1:770,y0:34,y1:360};
const CORES=[
  [255,255,255], // 0 fundo
  [232,236,241], // 1 grade
  [37,99,235],   // 2 linha
  [22,163,74],   // 3 menor
  [220,38,38],   // 4 maior
  [51,65,85],    // 5 texto
  [120,130,145], // 6 texto fraco
  [219,234,254], // 7 preenchimento
  [234,88,12],   // 8 valor pedido
];
const COR={fundo:0,grade:1,linha:2,menor:3,maior:4,texto:5,fraco:6,area:7,alvo:8};

// Fonte 5x7 só com o que o gráfico escreve (preços, datas e "alvo").
const FONTE={
  '0':['01110','10001','10011','10101','11001','10001','01110'],
  '1':['00100','01100','00100','00100','00100','00100','01110'],
  '2':['01110','10001','00001','00010','00100','01000','11111'],
  '3':['11111','00010','00100','00010','00001','10001','01110'],
  '4':['00010','00110','01010','10010','11111','00010','00010'],
  '5':['11111','10000','11110','00001','00001','10001','01110'],
  '6':['00110','01000','10000','11110','10001','10001','01110'],
  '7':['11111','00001','00010','00100','01000','01000','01000'],
  '8':['01110','10001','10001','01110','10001','10001','01110'],
  '9':['01110','10001','10001','01111','00001','00010','01100'],
  'R':['11110','10001','10001','11110','10100','10010','10001'],
  '$':['00100','01111','10100','01110','00101','11110','00100'],
  ',':['00000','00000','00000','00000','00110','00100','01000'],
  '.':['00000','00000','00000','00000','00000','01100','01100'],
  '/':['00001','00001','00010','00100','01000','10000','10000'],
  'a':['00000','00000','01110','00001','01111','10001','01111'],
  'l':['01100','00100','00100','00100','00100','00100','01110'],
  'v':['00000','00000','10001','10001','10001','01010','00100'],
  'o':['00000','00000','01110','10001','10001','10001','01110'],
  ' ':['00000','00000','00000','00000','00000','00000','00000'],
};

export function precoCurto(valor) {
  const [inteiro,centavos]=Number(valor).toFixed(2).split('.');
  return `R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g,'.')},${centavos}`;
}

const diaNumero=dia=>Math.floor(Date.UTC(+dia.slice(0,4),+dia.slice(5,7)-1,+dia.slice(8,10))/86400000);
const diaMes=n=>{const d=new Date(n*86400000);return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}`;};

function tela() {
  const px=new Uint8Array(LARGURA*ALTURA);
  const ponto=(x,y,c)=>{x=Math.round(x);y=Math.round(y);if(x>=0&&x<LARGURA&&y>=0&&y<ALTURA) px[y*LARGURA+x]=c;};
  const retangulo=(x,y,l,a,c)=>{for(let j=0;j<a;j++) for(let i=0;i<l;i++) ponto(x+i,y+j,c);};
  const circulo=(cx,cy,r,c)=>{for(let j=-r;j<=r;j++) for(let i=-r;i<=r;i++) if(i*i+j*j<=r*r) ponto(cx+i,cy+j,c);};
  const largura=(texto,escala=2)=>String(texto).length*6*escala-escala;
  const escrever=(texto,x,y,c,escala=2)=>{
    let cx=Math.round(x);
    for(const ch of String(texto)){
      const g=FONTE[ch]||FONTE[' '];
      g.forEach((linha,j)=>{for(let i=0;i<5;i++) if(linha[i]==='1') retangulo(cx+i*escala,Math.round(y)+j*escala,escala,escala,c);});
      cx+=6*escala;
    }
  };
  return {px,ponto,retangulo,circulo,largura,escrever};
}

// pontos: [{dia:'2026-11-20',preco:199.9}] em ordem de dia. Devolve os pixels
// (índices da paleta) e o resumo usado na legenda.
export function desenharGrafico(pontos,{alvo=null}={}) {
  const dados=pontos.filter(p=>p&&/^\d{4}-\d{2}-\d{2}$/.test(p.dia)&&Number(p.preco)>0)
    .map(p=>({n:diaNumero(p.dia),preco:Number(p.preco)})).sort((a,b)=>a.n-b.n);
  if(dados.length<2) return null;
  const t=tela();
  t.retangulo(0,0,LARGURA,ALTURA,COR.fundo);
  const precos=dados.map(d=>d.preco);
  const minimo=Math.min(...precos), maximo=Math.max(...precos);
  let baixo=minimo, alto=maximo;
  const usarAlvo=Number(alvo)>0&&alvo>=minimo*0.8&&alvo<=maximo*1.2;
  if(usarAlvo){baixo=Math.min(baixo,alvo);alto=Math.max(alto,alvo);}
  const folga=alto>baixo?(alto-baixo)*0.12:Math.max(1,alto*0.05);
  baixo=Math.max(0,baixo-folga); alto+=folga;
  const inicio=dados[0].n, fim=dados[dados.length-1].n;
  const xDe=n=>AREA.x0+(fim>inicio?(n-inicio)/(fim-inicio):0.5)*(AREA.x1-AREA.x0);
  const yDe=v=>AREA.y1-(v-baixo)/(alto-baixo)*(AREA.y1-AREA.y0);

  // Grade e preços no eixo.
  for(let i=0;i<4;i++){
    const valor=baixo+(alto-baixo)*i/3, y=Math.round(yDe(valor));
    for(let x=AREA.x0;x<=AREA.x1;x++) t.ponto(x,y,COR.grade);
    const rotulo=precoCurto(valor);
    t.escrever(rotulo,AREA.x0-12-t.largura(rotulo),y-7,COR.fraco);
  }
  // Datas embaixo.
  const marcas=fim-inicio>=4?5:2;
  for(let i=0;i<marcas;i++){
    const n=Math.round(inicio+(fim-inicio)*i/(marcas-1)), rotulo=diaMes(n);
    const x=Math.min(LARGURA-4-t.largura(rotulo),Math.max(AREA.x0-10,xDe(n)-t.largura(rotulo)/2));
    for(let y=AREA.y1;y<AREA.y1+6;y++) t.ponto(xDe(n),y,COR.fraco);
    t.escrever(rotulo,x,AREA.y1+16,COR.fraco);
  }
  // Linha em degraus (o preço vale até a próxima leitura), com área embaixo.
  let k=0, anterior=null;
  for(let x=Math.round(xDe(inicio));x<=Math.round(xDe(fim));x++){
    while(k+1<dados.length&&xDe(dados[k+1].n)<=x+0.5) k++;
    const y=Math.round(yDe(dados[k].preco));
    for(let j=y;j<=AREA.y1;j++) t.ponto(x,j,COR.area);
    const de=anterior===null?y:Math.min(anterior,y), ate=anterior===null?y:Math.max(anterior,y);
    for(let j=de-1;j<=ate+1;j++) t.retangulo(x-1,j,3,1,COR.linha);
    anterior=y;
  }
  for(let x=AREA.x0;x<=AREA.x1;x++) t.ponto(x,AREA.y1,COR.fraco);

  // Valor pedido: linha tracejada laranja.
  if(usarAlvo){
    const y=Math.round(yDe(alvo));
    for(let x=AREA.x0;x<=AREA.x1;x++) if(Math.floor((x-AREA.x0)/10)%2===0){t.ponto(x,y,COR.alvo);t.ponto(x,y+1,COR.alvo);}
    const rotulo=`alvo ${precoCurto(alvo)}`;
    t.escrever(rotulo,AREA.x1-t.largura(rotulo),y-20,COR.alvo);
  }
  // Marcas do menor e do maior (a primeira vez que apareceram) e do preço de agora.
  const marcar=(valor,cor,acima)=>{
    const d=dados.find(p=>p.preco===valor), x=xDe(d.n), y=yDe(valor);
    t.circulo(x,y,8,COR.fundo); t.circulo(x,y,6,cor);
    const rotulo=precoCurto(valor), l=t.largura(rotulo);
    const rx=Math.min(LARGURA-6-l,Math.max(AREA.x0+6,x-l/2));
    let ry=acima?y-30:y+14;
    if(ry<4) ry=y+14; if(ry>AREA.y1-16) ry=y-30;
    t.retangulo(rx-4,ry-3,l+8,20,COR.fundo);
    t.escrever(rotulo,rx,ry,cor);
    return d.n;
  };
  const ultimo=dados[dados.length-1];
  t.circulo(xDe(ultimo.n),yDe(ultimo.preco),6,COR.linha);
  const diaMaior=maximo>minimo?marcar(maximo,COR.maior,true):null;
  const diaMenor=marcar(minimo,COR.menor,false);
  return {px:t.px,minimo,maximo,diaMenor,diaMaior,inicio,fim,atual:ultimo.preco};
}

// --- PNG -------------------------------------------------------------------------

const TABELA_CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++) c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
function crc32(bytes) {
  let c=0xffffffff;
  for(const b of bytes) c=TABELA_CRC[(c^b)&0xff]^(c>>>8);
  return (c^0xffffffff)>>>0;
}
function bloco(tipo,dados) {
  const saida=new Uint8Array(12+dados.length), vista=new DataView(saida.buffer);
  vista.setUint32(0,dados.length);
  for(let i=0;i<4;i++) saida[4+i]=tipo.charCodeAt(i);
  saida.set(dados,8);
  vista.setUint32(8+dados.length,crc32(saida.subarray(4,8+dados.length)));
  return saida;
}
async function comprimir(bytes) {
  const fluxo=new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(fluxo).arrayBuffer());
}

export async function codificarPng(px,largura=LARGURA,altura=ALTURA,paleta=CORES) {
  const cabecalho=new Uint8Array(13), v=new DataView(cabecalho.buffer);
  v.setUint32(0,largura); v.setUint32(4,altura);
  cabecalho.set([8,3,0,0,0],8); // 8 bits, paleta, sem entrelaçar
  const cores=new Uint8Array(paleta.flat());
  const cru=new Uint8Array((largura+1)*altura);
  for(let y=0;y<altura;y++) cru.set(px.subarray(y*largura,(y+1)*largura),y*(largura+1)+1); // filtro 0
  const partes=[new Uint8Array([137,80,78,71,13,10,26,10]),bloco('IHDR',cabecalho),bloco('PLTE',cores),
    bloco('IDAT',await comprimir(cru)),bloco('IEND',new Uint8Array())];
  const total=new Uint8Array(partes.reduce((s,p)=>s+p.length,0));
  let pos=0; for(const p of partes){total.set(p,pos);pos+=p.length;}
  return total;
}

export async function graficoPng(pontos,opcoes={}) {
  const desenho=desenharGrafico(pontos,opcoes);
  if(!desenho) return null;
  return {...desenho,png:await codificarPng(desenho.px),px:undefined};
}
