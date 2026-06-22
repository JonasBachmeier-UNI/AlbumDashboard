// Production environment config. Swapped in for environment.ts at build time
// via the "fileReplacements" entry in angular.json.
export const environment = {
  production: true,
  lastfm: {
    apiKey: '50404a00f4d9d0cc28a05f144a039318',
    username: 'J0n455',
    baseUrl: 'https://ws.audioscrobbler.com/2.0/',
  },
};
