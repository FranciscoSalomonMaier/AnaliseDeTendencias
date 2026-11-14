declare module 'multer' {
  export function diskStorage(options: {
    destination: string;
    filename: (
      req: import('express').Request & { remixUploadPath?: string },
      file: { originalname: string; mimetype: string },
      callback: (error: Error | null, name: string) => void,
    ) => void;
  }): object;
}
