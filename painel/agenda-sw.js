'use strict';
// Painel antigo aposentado em 12/11/2026: este service worker apenas se remove.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.registration.unregister()));
