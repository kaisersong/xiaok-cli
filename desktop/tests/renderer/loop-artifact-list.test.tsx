import {cleanup,fireEvent,render,screen,waitFor,act} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {LocaleProvider} from '../../renderer/src/contexts/LocaleContext';
import {LoopArtifactList} from '../../renderer/src/components/loops/LoopArtifactList';
import {useLayoutEffect} from 'react';
const wire=vi.hoisted(()=>({listLoopPublishedArtifacts:vi.fn()}));
vi.mock('../../renderer/src/api/bridge',()=>({api:wire}));
const identity={runId:'run',candidateId:'candidate',candidateRevision:1,payloadHash:'a'.repeat(64)},first={loopId:'loop',checkedAt:1000,identity,offset:0,total:21,nextOffset:20,items:[{path:'original.bin',sha256:'b'.repeat(64),size:10,selection:{kind:'local',path:'original.bin',obligationId:'output'}}]};
beforeEach(()=>{wire.listLoopPublishedArtifacts.mockReset().mockResolvedValue(first);});afterEach(cleanup);
function show(epoch=0){return render(<LocaleProvider><LoopArtifactList loopId="loop" refreshGeneration={epoch}/></LocaleProvider>);}
it('loads only on explicit click, carries original identity into the next page, and clears failed observations',async()=>{
 show();expect(wire.listLoopPublishedArtifacts).not.toHaveBeenCalled();fireEvent.click(screen.getByTestId('loop-artifacts-open-loop'));await screen.findByText('original.bin');expect(wire.listLoopPublishedArtifacts).toHaveBeenCalledWith('loop',{offset:0,identity:null});
 wire.listLoopPublishedArtifacts.mockRejectedValue(Error('expired'));fireEvent.click(screen.getByTestId('loop-artifacts-next'));expect(screen.queryByText('original.bin')).toBeNull();await screen.findByRole('alert');expect(wire.listLoopPublishedArtifacts).toHaveBeenLastCalledWith('loop',{offset:20,identity});expect(screen.queryByTestId('loop-artifacts-observation')).toBeNull();
});
it('refresh invalidates pending responses and never restores their dated content',async()=>{
 let resolve!:(value:any)=>void;wire.listLoopPublishedArtifacts.mockImplementation(()=>new Promise(r=>resolve=r));const view=show();fireEvent.click(screen.getByTestId('loop-artifacts-open-loop'));view.rerender(<LocaleProvider><LoopArtifactList loopId="loop" refreshGeneration={1}/></LocaleProvider>);await act(async()=>resolve(first));expect(screen.queryByText('original.bin')).toBeNull();expect(screen.getByTestId('loop-artifacts-open-loop')).not.toBeDisabled();
});
it('never exposes the previous publication in the commit that changes its refresh identity',async()=>{
 const seen: boolean[]=[];
 function Parent({epoch}:{epoch:number}){useLayoutEffect(()=>{if(epoch)seen.push(document.querySelector('[data-testid="loop-artifacts-observation"]')!==null);},[epoch]);return <LocaleProvider><LoopArtifactList loopId="loop" refreshGeneration={epoch}/></LocaleProvider>;}
 const view=render(<Parent epoch={0}/>);fireEvent.click(screen.getByTestId('loop-artifacts-open-loop'));await screen.findByText('original.bin');view.rerender(<Parent epoch={1}/>);expect(seen).toEqual([false]);
});
it('returns to the first page with a new read instead of reusing a historical first-page token',async()=>{
 show();fireEvent.click(screen.getByTestId('loop-artifacts-open-loop'));await screen.findByText('original.bin');wire.listLoopPublishedArtifacts.mockResolvedValue({...first,offset:20,nextOffset:null,items:[{...first.items[0],path:'last.bin'}]});fireEvent.click(screen.getByTestId('loop-artifacts-next'));await screen.findByText('last.bin');fireEvent.click(screen.getByTestId('loop-artifacts-previous'));await waitFor(()=>expect(wire.listLoopPublishedArtifacts).toHaveBeenLastCalledWith('loop',{offset:0,identity:null}));
});
