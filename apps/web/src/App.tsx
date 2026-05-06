import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import { useCompressionJobState } from './hooks/useCompressionJobState';
import { useImportStepCompletion } from './hooks/useImportStepCompletion';
import CompressionPage from './pages/CompressionPage';
import DashboardPage from './pages/DashboardPage';
import GroupingPage from './pages/GroupingPage';
import ImportPage from './pages/ImportPage';
import JobsPage from './pages/JobsPage';
import SelectionPage from './pages/SelectionPage';

const GuardedWorkflowStep = ({ children }: { children: JSX.Element }) => {
  const isImportStepComplete = useImportStepCompletion();

  if (!isImportStepComplete) {
    return <Navigate to="/import" replace />;
  }

  return children;
};

const GuardedGroupingStep = ({ children }: { children: JSX.Element }) => {
  const isImportStepComplete = useImportStepCompletion();
  const compressionJobState = useCompressionJobState();

  if (!isImportStepComplete) {
    return <Navigate to="/import" replace />;
  }

  if (compressionJobState.status !== 'completed') {
    return <Navigate to="/compression" replace />;
  }

  return children;
};

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route
            path="/selection"
            element={
              <GuardedWorkflowStep>
                <SelectionPage />
              </GuardedWorkflowStep>
            }
          />
          <Route path="/preview" element={<Navigate to="/selection" replace />} />
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
              <GuardedGroupingStep>
                <GroupingPage />
              </GuardedGroupingStep>
            }
          />
          <Route path="/jobs" element={<JobsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

export default App;
