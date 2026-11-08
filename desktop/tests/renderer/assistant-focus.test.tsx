import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,act,cleanup} from '@testing-library/react';
import {MemoryRouter,useLocation} from 'react-router-dom';
import {useAssistantFocus} from '../../renderer/src/hooks/useAssistantFocus';
const h=vi.hoisted(()=>({focus:undefined as (()=>void)|undefined,stop:vi.fn()}));
vi.mock('../../renderer/src/shared/desktop',()=>({getDesktopApi:()=>({onAssistantInboxFocus:(fn:()=>void)=>{h.focus=fn;return h.stop}})}));
function Harness(){useAssistantFocus();const location=useLocation();return <output data-focus={location.state?.assistantMorningFocus?'morning':'none'}>{location.pathname}</output>}
afterEach(cleanup);
it('navigates only on the fixed notification click and removes its own listener',()=>{const v=render(<MemoryRouter initialEntries={['/t/user-task']}><Harness/></MemoryRouter>);expect(screen.getByRole('status')).toHaveTextContent('/t/user-task');act(()=>h.focus?.());expect(screen.getByRole('status')).toHaveTextContent('/assistant');expect(screen.getByRole('status')).toHaveAttribute('data-focus','morning');v.unmount();expect(h.stop).toHaveBeenCalledTimes(1);});
