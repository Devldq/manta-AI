import { useState } from 'react';

export default function AppsPage() {
  const [apps] = useState([]);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Apps</h1>
      <div className="bg-[var(--color-surface)] rounded-lg p-4">
        {apps.length === 0 ? (
          <p className="text-[var(--color-text-muted)]">No apps configured</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* App cards will be rendered here */}
          </div>
        )}
      </div>
    </div>
  );
}
