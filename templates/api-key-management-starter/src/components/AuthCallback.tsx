import { bridgeFabricCallback } from '@microsoft/rayfin-auth-provider-fabric';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function AuthCallback() {
  const navigate = useNavigate();
  const [message, setMessage] = useState('Processing authentication...');

  useEffect(() => {
    try {
      const bridged = bridgeFabricCallback();
      if (!bridged) {
        setMessage('No authentication callback was found.');
        navigate('/auth', { replace: true });
      }
    } catch (error) {
      console.error('Auth callback failed:', error);
      setMessage('Authentication failed. Redirecting...');
      navigate('/auth', { replace: true });
    }
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-white text-sm text-slate-500">
      {message}
    </div>
  );
}
