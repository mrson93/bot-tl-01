const unique=values=>[...new Set(values.filter(Boolean))];
const matches=(text,regex,format=match=>match[0])=>unique([...text.matchAll(regex)].map(format));

export const SPEC_LABELS={battery:'Capacidade',power:'Potência',storage:'Memória/capacidade',screen:'Tela',resolution:'Resolução',refresh:'Taxa de atualização',voltage:'Voltagem',dimensions:'Dimensões',purpose:'Indicação',upper:'Cabedal',sole:'Entressola/solado',features:'Recursos'};

export function extractProductSpecs(title='') {
  const text=String(title||''),lower=text.toLocaleLowerCase('pt-BR'),specs={};
  const battery=matches(text,/(\d{3,6}(?:[.,]\d+)?)\s*m\s*ah/gi,match=>`${match[1].replace('.',',')} mAh`);
  const power=matches(text,/(\d{1,4}(?:[.,]\d+)?)\s*w(?:atts?)?\b/gi,match=>`${match[1].replace('.',',')} W`);
  const storage=matches(text,/(\d+(?:[.,]\d+)?)\s*(tb|gb)\b/gi,match=>`${match[1].replace('.',',')} ${match[2].toUpperCase()}`);
  const screen=matches(text,/(\d{1,3}(?:[.,]\d+)?)\s*(?:["”]|pol(?:egadas?)?)(?=\s|$|[,;])/gi,match=>`${match[1].replace('.',',')}″`);
  const resolution=matches(text,/\b(8k|4k|uhd|qhd|full\s*hd|fhd|hd)\b/gi,match=>match[1].replace(/\s+/g,' ').toUpperCase());
  const refresh=matches(text,/(\d{2,3})\s*hz\b/gi,match=>`${match[1]} Hz`);
  const voltage=matches(text,/\b(bivolt|110\s*v|127\s*v|220\s*v)\b/gi,match=>match[1].replace(/\s+/g,'').replace(/^bivolt$/i,'Bivolt').toUpperCase().replace('BIVOLT','Bivolt'));
  const dimensions=matches(text,/\b(\d{1,4}\s*x\s*\d{1,4}(?:\s*x\s*\d{1,4})?)\s*(mm|cm|m)\b/gi,match=>`${match[1].replace(/\s+/g,'')} ${match[2].toLowerCase()}`);
  const purpose=[];for(const [pattern,label] of [[/corrida|running/i,'Corrida'],[/maratona/i,'Maratona'],[/caminhada/i,'Caminhada'],[/trilha|trail/i,'Trilha'],[/casual/i,'Uso casual'],[/academia|fitness/i,'Academia']])if(pattern.test(lower))purpose.push(label);
  const upper=[];for(const [pattern,label] of [[/malha|mesh/i,'Malha/mesh'],[/couro/i,'Couro'],[/knit/i,'Knit'],[/respir[aá]vel/i,'Respirável']])if(pattern.test(lower))upper.push(label);
  const sole=[];for(const [pattern,label] of [[/placa de carbono|carbon plate/i,'Placa de carbono anunciada'],[/\beva\b/i,'EVA'],[/borracha/i,'Borracha'],[/amortecimento/i,'Amortecimento anunciado']])if(pattern.test(lower))sole.push(label);
  const features=[];
  const bluetooth=lower.match(/bluetooth\s*(\d+(?:[.,]\d+)?)?/i);if(bluetooth)features.push(`Bluetooth${bluetooth[1]?` ${bluetooth[1].replace(',','.')}`:''}`);
  const featurePatterns=[[/\bwi[ -]?fi\b/i,'Wi-Fi'],[/\b5g\b/i,'5G'],[/\b4g\b/i,'4G'],[/\busb[ -]?c\b/i,'USB-C'],[/\bnfc\b/i,'NFC'],[/\bgps\b/i,'GPS'],[/\banc\b|cancelamento (?:ativo )?de ru[ií]do/i,'ANC'],[/sem fio|wireless/i,'Sem fio'],[/magn[eé]tic/i,'Magnético'],[/carregamento r[aá]pido|fast charg/i,'Carga rápida'],[/resistente [àa] [aá]gua|imperme[aá]vel/i,'Resistente à água']];
  for(const [pattern,label] of featurePatterns)if(pattern.test(lower))features.push(label);
  if(battery.length)specs.battery=battery.join(' / ');if(power.length)specs.power=power.join(' / ');if(storage.length)specs.storage=storage.join(' / ');if(screen.length)specs.screen=screen.join(' / ');
  if(resolution.length)specs.resolution=resolution.join(' / ');if(refresh.length)specs.refresh=refresh.join(' / ');if(voltage.length)specs.voltage=voltage.join(' / ');if(dimensions.length)specs.dimensions=dimensions.join(' / ');
  if(purpose.length)specs.purpose=unique(purpose).join(', ');if(upper.length)specs.upper=unique(upper).join(', ');if(sole.length)specs.sole=unique(sole).join(', ');if(features.length)specs.features=unique(features).join(', ');
  return specs;
}
