import { useParams } from 'react-router-dom';
import { useKSwarm } from '../../contexts/KSwarmContext';
import { CollaborationRoomView } from './CollaborationRoomView';

export function CollaborationRoomPage() {
  const { roomId = '' } = useParams();
  const { agents } = useKSwarm();
  return <CollaborationRoomView roomId={roomId} availableAgents={agents.map(({ id, name }) => ({ id, name }))} />;
}
