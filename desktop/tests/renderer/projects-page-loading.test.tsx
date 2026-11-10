import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {ProjectsPage} from '../../renderer/src/components/projects/ProjectsPage';
import {LocaleProvider} from '../../renderer/src/contexts/LocaleContext';
import {zh} from '../../renderer/src/locales/zh';
const state=vi.hoisted(()=>({loaded:false}));
vi.mock('../../renderer/src/contexts/KSwarmContext',()=>({useKSwarm:()=>({projects:[],agents:[],createProject:vi.fn(),connected:true,projectsLoaded:state.loaded})}));
vi.mock('../../renderer/src/components/projects/CreateProjectModal',()=>({CreateProjectModal:()=>null}));
vi.mock('../../renderer/src/components/projects/CreateAgentModal',()=>({CreateAgentModal:()=>null}));
vi.mock('../../renderer/src/components/projects/AgentsTab',()=>({AgentsTab:()=>null}));
vi.mock('../../renderer/src/components/projects/PrinciplesTab',()=>({PrinciplesTab:()=>null}));
afterEach(()=>{cleanup();state.loaded=false;});
it('shows loading until the first successful snapshot rather than claiming no projects',()=>{
 render(<MemoryRouter><LocaleProvider><ProjectsPage/></LocaleProvider></MemoryRouter>);
 expect(screen.queryByText(zh.projectsPageEmpty)).toBeNull();expect(screen.getByRole('status').textContent).toContain(zh.loading);
});
it('shows the empty state after a successful empty snapshot',()=>{
 state.loaded=true;render(<MemoryRouter><LocaleProvider><ProjectsPage/></LocaleProvider></MemoryRouter>);
 expect(screen.getByText(zh.projectsPageEmpty)).toBeTruthy();
});
