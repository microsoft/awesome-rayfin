import { useState } from 'react';

import { ProfileImage } from '../components/ProfileImage';
import { ProfileImageModal } from '../components/ProfileImageModal';
import { TodoList } from '../components/TodoList';
import { useAuth } from '../hooks/AuthContext';

export function Dashboard() {
  const { user, logout } = useAuth();
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <h1 className="text-xl font-semibold text-gray-900">Todo App</h1>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-3">
                <ProfileImage
                  userId={user.Id}
                  size="sm"
                  alt={`${user.Name}'s profile`}
                  clickable={true}
                  onClick={() => setIsProfileModalOpen(true)}
                />
                <span className="text-sm text-gray-600">
                  Welcome, {user.Name}
                </span>
              </div>
              <button
                onClick={logout}
                className="bg-transparent border-0 text-sm font-medium text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md hover:bg-gray-100 transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <TodoList />
      </main>

      <ProfileImageModal
        userId={user.Id}
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
      />
    </div>
  );
}
