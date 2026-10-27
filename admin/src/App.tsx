import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SessionProvider, useSession } from './session';
import { DialogProvider, Loading } from './ui/ui';
import Layout from './Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Review from './pages/Review';
import Offers from './pages/Offers';
import NewOffer from './pages/NewOffer';
import Publications from './pages/Publications';
import Destinations from './pages/Destinations';
import Connectors from './pages/Connectors';
import Templates from './pages/Templates';
import Analytics from './pages/Analytics';
import Audit from './pages/Audit';
import Health from './pages/Health';
import SettingsPage from './pages/Settings';
import Users from './pages/Users';
import Messenger from './pages/Messenger';
import ConversasFull from './pages/ConversasFull';

function Gate() {
  const { state } = useSession();
  if (!state) return <Loading />;
  if (state.status !== 'ready') return <Login />;
  return (
    <Routes>
      <Route path="conversas" element={<ConversasFull />} />
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="revisao" element={<Review />} />
        <Route path="ofertas" element={<Offers />} />
        <Route path="ofertas/nova" element={<NewOffer />} />
        <Route path="publicacoes" element={<Publications />} />
        <Route path="whatsapp" element={<Messenger channel="whatsapp" />} />
        <Route path="telegram" element={<Messenger channel="telegram" />} />
        <Route path="destinos" element={<Destinations />} />
        <Route path="conectores" element={<Connectors />} />
        <Route path="templates" element={<Templates />} />
        <Route path="configuracoes" element={<SettingsPage />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="saude" element={<Health />} />
        <Route path="auditoria" element={<Audit />} />
        <Route path="usuarios" element={<Users />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
export default function App() {
  return <SessionProvider><DialogProvider><HashRouter><Gate /></HashRouter></DialogProvider></SessionProvider>;
}
