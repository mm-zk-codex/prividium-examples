import { handleAuthCallback } from 'prividium';

handleAuthCallback((error) => {
  if (error) {
    console.error('Auth callback error:', error);
  }
});
