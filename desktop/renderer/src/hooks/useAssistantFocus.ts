import {useEffect,useRef} from 'react';
import {useNavigate} from 'react-router-dom';
import {getDesktopApi} from '../shared/desktop';
/** The notification click is a navigation event, never an execution request. */
export function useAssistantFocus(){const navigate=useNavigate(),latest=useRef(navigate);latest.current=navigate;useEffect(()=>getDesktopApi()?.onAssistantInboxFocus?.(()=>latest.current('/assistant',{state:{assistantMorningFocus:true}})),[]);}
