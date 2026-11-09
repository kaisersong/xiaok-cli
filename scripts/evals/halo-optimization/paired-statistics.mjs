export const MASTER_SEED=0x20261101;
export const CELL_ORDER=Object.freeze(['small-steady','small-missing-marker','medium-steady','medium-missing-marker','large-steady','large-missing-marker']);
const KINDS=Object.freeze(['claim','page','complete']),ITERATIONS=10000;
const fail=code=>{throw Error(code);};
export function makeRandom(seed){
 if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)fail('stat_invalid_seed');
 let state=seed>>>0;
 return ()=>{state=(state+0x6d2b79f5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}
export function cellSeed(key){const i=CELL_ORDER.indexOf(key);if(i<0)fail('stat_invalid_cell');return (MASTER_SEED^Math.imul(i+1,0x9e3779b9))>>>0;}
export function makeWeights(n,random){
 if(!Number.isSafeInteger(n)||n<1||n>65535||typeof random!=='function')fail('stat_invalid_weights');
 const weights=new Uint32Array(n);
 for(let i=0;i<n;i++){const u=random();if(!Number.isFinite(u)||u<0||u>=1)fail('stat_invalid_random_draw');weights[Math.floor(u*n)]++;}
 return weights;
}
function latency(value){if(!Number.isFinite(value)||value<=0)fail('stat_invalid_latency');return value;}
export function prepareWeighted(groups){
 if(!Array.isArray(groups)||groups.length<1||groups.length>65535)fail('stat_invalid_cluster');
 const entries=[],sizes=new Uint32Array(groups.length);
 for(let i=0;i<groups.length;i++){
  const group=groups[i];if(!Array.isArray(group)||group.length<1||entries.length+group.length>10000000)fail('stat_invalid_cluster');
  sizes[i]=group.length;for(const value of group)entries.push([latency(value),i]);
 }
 entries.sort((a,b)=>a[0]-b[0]);
 return {values:Float64Array.from(entries,e=>e[0]),owners:Uint32Array.from(entries,e=>e[1]),sizes};
}
function rank(sorted,weights,p){
 let total=0;for(let i=0;i<weights.length;i++)total+=weights[i]*sorted.sizes[i];
 if(!Number.isSafeInteger(total)||total<=0)fail('stat_invalid_weights');
 const threshold=Math.ceil(total*p);let seen=0;
 for(let i=0;i<sorted.values.length;i++){seen+=weights[sorted.owners[i]];if(seen>=threshold)return sorted.values[i];}
 fail('stat_invalid_rank');
}
export function weightedQuantile(sorted,weights,p=.95){
 if(!Number.isFinite(p)||p<=0||p>1||!(sorted?.values instanceof Float64Array)||!(sorted.owners instanceof Uint32Array)||!(sorted.sizes instanceof Uint32Array)||sorted.values.length!==sorted.owners.length||weights?.length!==sorted.sizes.length)fail('stat_invalid_weights');
 for(const w of weights)if(!Number.isSafeInteger(w)||w<0)fail('stat_invalid_weights');
 for(let i=0;i<sorted.values.length;i++)if(!Number.isFinite(sorted.values[i])||sorted.values[i]<=0||sorted.owners[i]>=weights.length||(i&&sorted.values[i]<sorted.values[i-1]))fail('stat_invalid_rank');
 return rank(sorted,weights,p);
}
function ratio(candidate,baseline){const r=candidate/baseline;if(!Number.isFinite(r)||r<=0)fail('stat_unrepresentable_ratio');return r;}
function validateCell(cell,ids){
 if(!Number.isSafeInteger(cell.expectedPairs)||cell.expectedPairs<30||cell.expectedPairs>65535||!Array.isArray(cell.pairs)||cell.pairs.length!==cell.expectedPairs)fail('stat_pair_count');
 if(!Number.isSafeInteger(cell.cyclesPerGroup)||cell.cyclesPerGroup<100||cell.expectedPairs*cell.cyclesPerGroup>10000000)fail('stat_invalid_group_size');
 for(const pair of cell.pairs){
  if(typeof pair?.id!=='string'||! /^[a-z0-9-]{8,128}$/.test(pair.id)||ids.has(pair.id)||pair.baseline?.pairId!==pair.id||pair.candidate?.pairId!==pair.id)fail('stat_pair_identity');ids.add(pair.id);
  for(const arm of [pair.baseline,pair.candidate]){
   if(!arm.operations||Object.keys(arm.operations).sort().join(',')!=='claim,complete,page')fail('stat_incomplete_kinds');
   for(const kind of KINDS){const values=arm.operations[kind];if(!Array.isArray(values)||values.length!==cell.cyclesPerGroup)fail('stat_invalid_group_size');for(const value of values)latency(value);}
  }
 }
}
export function evaluateCells(input){
 if(arguments.length!==1)fail('stat_seed_override');
 if(!Array.isArray(input)||input.length!==CELL_ORDER.length)fail('stat_incomplete_cells');
 const map=new Map();for(const c of input){if(!CELL_ORDER.includes(c?.key)||map.has(c.key))fail('stat_incomplete_cells');map.set(c.key,c);}
 const ids=new Set();for(const key of CELL_ORDER)validateCell(map.get(key),ids);
 const cells=[];
 for(const key of CELL_ORDER){
  const cell=map.get(key),random=makeRandom(cellSeed(key)),prepared=Object.fromEntries(KINDS.map(kind=>[kind,{baseline:prepareWeighted(cell.pairs.map(p=>p.baseline.operations[kind])),candidate:prepareWeighted(cell.pairs.map(p=>p.candidate.operations[kind])),ratios:new Float64Array(ITERATIONS)}]));
  for(let b=0;b<ITERATIONS;b++){
   const weights=makeWeights(cell.expectedPairs,random);
   for(const kind of KINDS){const p=prepared[kind];p.ratios[b]=ratio(rank(p.candidate,weights,.95),rank(p.baseline,weights,.95));}
  }
  const metrics={};
  for(const kind of KINDS){
   const p=prepared[kind];p.ratios.sort();const baselineP95Ms=p.baseline.values[Math.ceil(.95*p.baseline.values.length)-1],candidateP95Ms=p.candidate.values[Math.ceil(.95*p.candidate.values.length)-1];
   const upper95=p.ratios[9499],lower025=p.ratios[249],upper975=p.ratios[9749],halfWidth95=(upper975-lower025)/2;
   metrics[kind]={baselineP95Ms,candidateP95Ms,ratio:ratio(candidateP95Ms,baselineP95Ms),upper95,lower025,upper975,halfWidth95,bootstrapIterations:ITERATIONS,postWarmupObservationsPerArm:cell.expectedPairs*cell.cyclesPerGroup,criterionPassed:upper95<=.95&&halfWidth95<=.025};
  }
  cells.push({key,seed:cellSeed(key),matchedPairs:cell.expectedPairs,cyclesPerGroup:cell.cyclesPerGroup,metrics});
 }
 return {schema:'halo-macos-paired-statistical-criterion/v1',qualified:false,statisticalCriterionPassed:cells.every(c=>KINDS.every(k=>c.metrics[k].criterionPassed)),method:'within-cell pooled nearest-rank p95 ratio; matched-whole-trajectory bootstrap; shared draws across both arms and three operation kinds',masterSeed:MASTER_SEED,bootstrapIterations:ITERATIONS,cells,scope:'statistical criterion only; native/source/authority/peer/resource/App gates remain required; numeric data alone never qualify'};
}
