import { useState } from 'react';

export default function TasksPage() {
  const [tasks] = useState([]);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Tasks</h1>
      <div className="bg-[var(--color-surface)] rounded-lg p-4">
        {tasks.length === 0 ? (
          <p className="text-[var(--color-text-muted)]">No tasks yet</p>
        ) : (
          <ul className="space-y-2">
            {/* Task list will be rendered here */}
          </ul>
        )}
      </div>
    </div>
  );
}
