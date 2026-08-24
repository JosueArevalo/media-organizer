import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  GroupingMoveMenu,
  type GroupingMoveDestination
} from '../../src/components/GroupingMoveMenu';
import '../../src/styles.css';

const destinations: GroupingMoveDestination[] = [
  { key: 'folder:family', label: 'Family album' },
  { key: 'preserved:trips', label: 'Preserved trips', preservedScopePath: 'Trips' }
];

const GroupingMoveMenuFixture = () => {
  const [selectedDestination, setSelectedDestination] = useState('none');

  return (
    <main style={{ maxWidth: 760, margin: '60px auto', padding: 24 }}>
      <section className="grouping-selection-bar">
        <strong>1 selected</strong>
        <GroupingMoveMenu
          destinations={destinations}
          label="Move selected"
          onSelect={(destination) => setSelectedDestination(destination.key)}
        />
      </section>

      <button type="button">Outside control</button>
      <output data-testid="selected-destination">{selectedDestination}</output>

      <section className="grouping-modal-actions" style={{ marginTop: 80 }}>
        <button type="button">Previous</button>
        <GroupingMoveMenu
          destinations={destinations}
          label="Move preview"
          onSelect={(destination) => setSelectedDestination(destination.key)}
        />
      </section>

      <section style={{ marginTop: 80 }}>
        <GroupingMoveMenu destinations={[]} label="No destinations" onSelect={() => undefined} />
      </section>
    </main>
  );
};

const root = document.getElementById('root');
if (!root) throw new Error('Interaction fixture root was not found.');

createRoot(root).render(
  <StrictMode>
    <GroupingMoveMenuFixture />
  </StrictMode>
);
