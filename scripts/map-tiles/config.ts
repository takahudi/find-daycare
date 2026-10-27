export const MAP_AREA = {
  bbox: [135.36, 34.56, 135.62, 34.77],
  minZoom: 0,
  maxZoom: 15,
} as const;

export const MAP_R2_ENVIRONMENT = {
  variables: {
    accountId: 'R2_ACCOUNT_ID',
    accessKeyId: 'R2_MAP_ACCESS_KEY_ID',
    secretAccessKey: 'R2_MAP_SECRET_ACCESS_KEY',
    bucket: 'R2_MAP_BUCKET',
  },
  readmeSection: '地図タイルを作る・保管する',
} as const;

export const MAP_R2_REQUEST_TIMEOUTS = { PUT: 15 * 60_000 } as const;
