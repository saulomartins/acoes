// @ts-nocheck
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import {colors} from '../ui/theme';
import {useBreakpoint} from '../ui/responsive';

const MONTHS=['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
const brl=(n:number)=>(Number(n||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const parts=(iso:string)=>{const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?{y:m[1],mo:m[2],d:m[3]}:null};
const monthLabel=(referenceMonth:string)=>{const p=parts(referenceMonth);if(!p)return '';return `${MONTHS[Number(p.mo)-1]}/${p.y}`};
const periodLabel=(start:string,end:string)=>{const s=parts(start),e=parts(end);if(!s||!e)return '';return `${s.d}/${s.mo} a ${e.d}/${e.mo}`};
const footerDate=(referenceMonth:string)=>{const p=parts(referenceMonth);if(!p)return '';return `1 de ${MONTHS[Number(p.mo)-1]}-${p.y}`};

// Data e valor têm formato fixo e conhecido ("15/06/2026", "R$ 2.983,92"): no
// celular ganham largura fixa suficiente e encolhem a fonte até caber, em vez de
// disputar espaço por flex e quebrar no meio ("R$ 2.983,9" / "2"). Empresa e
// objetivo ficam com o que sobra e podem usar mais de uma linha, que é o
// comportamento natural de texto livre.
const noWrap={numberOfLines:1,adjustsFontSizeToFit:true,minimumFontScale:0.6} as const;

function Row({cells,head,bold,compact}:{cells:string[];head?:boolean;bold?:boolean;compact?:boolean}){
  const widths=[styles.colOrigin,styles.colApto,styles.colData,styles.colValor];
  const compactWidths=[styles.colOriginCompact,styles.colAptoCompact,styles.colDataCompact,styles.colValorCompact];
  return <View style={styles.row}>{cells.map((c,i)=>(
    <View key={i} style={[styles.cell,compact&&styles.cellCompact,widths[i],compact&&compactWidths[i],i===cells.length-1&&styles.cellLast]}>
      <Text {...(compact&&i>=2?noWrap:{})} style={[styles.cellText,compact&&styles.cellTextCompact,head&&styles.cellHead,bold&&styles.cellBold]}>{c}</Text>
    </View>
  ))}</View>;
}

export default function AccountabilityReportView({report,printId}:{report:any;printId?:string}){
  const {isMobile}=useBreakpoint();
  // O portal de impressão sai em papel A4: lá a folha mantém as proporções
  // originais, independente da largura da janela.
  const compact=isMobile&&!printId;
  const receiptRows=[
    report.paid_units?`${report.paid_units} apartamentos pagos`:null,
    report.exempt_units?`${report.exempt_units} isento${report.exempt_units>1?'s':''}`:null,
    report.unpaid_units?`${report.unpaid_units} não pagos`:null,
  ].filter(Boolean) as string[];
  const negative=Number(report.balance_cents)<0;
  return (
    <View nativeID={printId} style={[styles.sheet,compact&&styles.sheetCompact]}>
      <Text style={styles.title}>Fluxo de Caixa Condomínio {report.origin}</Text>
      <Text style={styles.subtitle}>Mês: {monthLabel(report.reference_month)}</Text>

      <Text style={styles.section}>RECEITA</Text>
      <View style={styles.table}>
        <Row compact={compact} head cells={['Origem','Apto','Data','Valor']}/>
        {receiptRows.map((label,i)=><Row compact={compact} key={i} cells={['',label,'','']}/>)}
        <Row compact={compact} cells={['Condomínio','',periodLabel(report.period_start,report.period_end),'']}/>
        <Row compact={compact} bold cells={['Total A','','',brl(report.received_amount_cents)]}/>
      </View>

      <Text style={styles.section}>DESPESAS</Text>
      <View style={styles.table}>
        <Row compact={compact} head cells={['Empresa','Objetivo','Data','Valor']}/>
        {report.expenses.map((e:any)=><Row compact={compact} key={e.id} cells={[e.provider,e.purpose,e.serviceDate,brl(e.amountCents)]}/>)}
        <Row compact={compact} bold cells={['Total','','',brl(report.total_expenses_cents)]}/>
      </View>

      <View style={[styles.balanceRow,negative&&styles.balanceNegative]}>
        <Text style={[styles.balanceLabel,negative&&styles.balanceTextNegative]}>Saldo do Mês</Text>
        <Text {...(compact?noWrap:{})} style={[styles.balanceValue,negative&&styles.balanceTextNegative]}>{brl(report.balance_cents)}</Text>
      </View>

      <Text style={styles.footer}>{report.city||''} {footerDate(report.reference_month)}</Text>

      <View style={styles.signatures}>
        <View style={styles.signCol}><Text style={styles.signLine}>{report.sindico_name||''}</Text><Text style={styles.signLabel}>Sindico</Text></View>
        <View style={styles.signCol}><Text style={styles.signLine}>{report.subsindico_name||''}</Text><Text style={styles.signLabel}>Subsindico</Text></View>
      </View>
      <View style={styles.signatures}>
        <View style={styles.signCol}><Text style={styles.signLine}>{report.fiscal_council_1_name||''}</Text><Text style={styles.signLabel}>Conselho Fiscal</Text></View>
        <View style={styles.signCol}><Text style={styles.signLine}>{report.fiscal_council_2_name||''}</Text><Text style={styles.signLabel}>Conselho Fiscal</Text></View>
      </View>
    </View>
  );
}

const styles=StyleSheet.create({
  sheet:{backgroundColor:'#fff',padding:24,borderWidth:1,borderColor:colors.border,borderRadius:8},
  // Cada dp economizado na margem vira largura de coluna: com padding 24 sobravam
  // ~280dp para as 4 colunas, com 10 sobram ~306dp.
  sheetCompact:{padding:10},
  title:{fontSize:20,fontWeight:'900',color:colors.ink,textAlign:'center'},
  subtitle:{fontSize:15,fontWeight:'800',color:colors.ink,textAlign:'center',marginTop:4,marginBottom:16},
  section:{fontWeight:'900',fontSize:14,color:colors.ink,marginTop:18,marginBottom:6},
  table:{borderWidth:1,borderColor:colors.ink},
  row:{flexDirection:'row',borderTopWidth:1,borderTopColor:colors.ink},
  cell:{borderRightWidth:1,borderRightColor:colors.ink,paddingVertical:5,paddingHorizontal:6},
  cellCompact:{paddingVertical:4,paddingHorizontal:4},
  cellLast:{borderRightWidth:0},
  colOrigin:{flex:2.4},
  colApto:{flex:1},
  colData:{flex:1.6},
  colValor:{flex:1.4},
  // No celular data e valor saem do flex e viram largura fixa, dimensionada para
  // o maior conteúdo possível ("15/06/2026" e "R$ 12.345,67") na fonte reduzida.
  // Empresa e objetivo dividem o que sobra, em partes iguais.
  colOriginCompact:{flex:1},
  colAptoCompact:{flex:1},
  colDataCompact:{flex:0,width:60},
  colValorCompact:{flex:0,width:74},
  cellText:{fontSize:12,color:colors.ink},
  cellTextCompact:{fontSize:11},
  cellHead:{fontWeight:'900'},
  cellBold:{fontWeight:'900'},
  balanceRow:{flexDirection:'row',justifyContent:'space-between',backgroundColor:colors.softBlue,borderWidth:1,borderColor:colors.ink,borderTopWidth:0,padding:8},
  balanceNegative:{backgroundColor:colors.red},
  balanceTextNegative:{color:'#fff'},
  balanceLabel:{fontWeight:'900',color:colors.ink},
  balanceValue:{fontWeight:'900',color:colors.ink},
  footer:{marginTop:22,fontSize:12,color:colors.ink},
  signatures:{flexDirection:'row',marginTop:34,gap:24},
  signCol:{flex:1,alignItems:'center'},
  signLine:{borderTopWidth:1,borderTopColor:colors.ink,width:'90%',textAlign:'center',paddingTop:4,fontSize:13,color:colors.ink,minHeight:20},
  signLabel:{fontSize:11,color:colors.muted,marginTop:2},
});
