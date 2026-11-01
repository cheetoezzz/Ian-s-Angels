if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL.replace(/\/?$/, '/')}service-worker.js`)
      .catch(error => console.error('Offline setup failed:', error));
  }, { once: true });
}
