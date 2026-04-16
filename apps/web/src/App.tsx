import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { CompressionPage } from './pages/CompressionPage';
import { DashboardPage } from './pages/DashboardPage';
import { GroupingPage } from './pages/GroupingPage';
import { ImportPage } from './pages/ImportPage';
import { JobsPage } from './pages/JobsPage';
import { PreviewPage } from './pages/PreviewPage';

export const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/preview" element={<PreviewPage />} />
          <Route path="/compression" element={<CompressionPage />} />
          <Route path="/grouping" element={<GroupingPage />} />
          <Route path="/jobs" element={<JobsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};
