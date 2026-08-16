export type ExtractedBlock = {
  content: string;
  page?: number;
  heading?: string;
};

export type Chunk = {
  content: string;
  metadata: {
    page?: number;
    heading?: string;
  };
};
