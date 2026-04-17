import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { useImportStepCompletion } from './hooks/useImportStepCompletion';
import { CompressionPage } from './pages/CompressionPage';
import { DashboardPage } from './pages/DashboardPage';
import { GroupingPage } from './pages/GroupingPage';
import { ImportPage } from './pages/ImportPage';
import { JobsPage } from './pages/JobsPage';
import { PreviewPage } from './pages/PreviewPage';

const GuardedWorkflowStep = ({ children }: { children: JSX.Element }) => {
  const isImportStepComplete = useImportStepCompletion();

  if (!isImportStepComplete) {
    return <Navigate to="/import" replace />;
  }

  return children;
};

export const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route
            path="/preview"
            element={
              <GuardedWorkflowStep>
                <PreviewPage />
              </GuardedWorkflowStep>
            }
          />
          <Route
            path="/compression"
            element={
              <GuardedWorkflowStep>
                <CompressionPage />
              </GuardedWorkflowStep>
            }
          />
          <Route
            path="/grouping"
            element={
              <GuardedWorkflowStep>
                <GroupingPage />
              </GuardedWorkflowStep>
            }
          />
          <Route path="/jobs" element={<JobsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};
