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
    parentIndex?: number;
  };
  /** Denormalized parent passage used in prompts when parent/child chunking is enabled. */
  parentContent?: string;
};
