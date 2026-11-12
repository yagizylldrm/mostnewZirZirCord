import { closeModal, useUi } from '../lib/zz';
import { ChannelModal } from './ChannelModal';
import { NotificationSettingsModal } from './NotificationSettingsModal';
import { CreateSessionModal, JoinSessionModal, NicknameModal } from './SessionModals';
import { SessionSettingsModal } from './SessionSettingsModal';
import { UserSettingsModal } from './UserSettingsModal';

export function Modals() {
  const modal = useUi((u) => u.modal);
  if (!modal) return null;
  switch (modal.type) {
    case 'createSession':
      return <CreateSessionModal />;
    case 'joinSession':
      return <JoinSessionModal initialCode={modal.code} />;
    case 'createChannel':
      return <ChannelModal type={modal.channelType} />;
    case 'editChannel':
      return <ChannelModal channelId={modal.channelId} />;
    case 'nickname':
      return <NicknameModal />;
    case 'notifications':
      return <NotificationSettingsModal sessionId={modal.sessionId} />;
    case 'sessionSettings':
      return <SessionSettingsModal />;
    case 'userSettings':
      return <UserSettingsModal />;
    default:
      closeModal();
      return null;
  }
}
