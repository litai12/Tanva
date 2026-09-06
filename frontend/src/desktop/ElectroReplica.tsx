import DesktopShell from './DesktopShell';
import './jzxzDesktop.css';

/** The reference skin shares the live task/session/plugin tree. */
export default function ElectroReplica() {
  return <div className="jzxz-desktop"><DesktopShell /></div>;
}
