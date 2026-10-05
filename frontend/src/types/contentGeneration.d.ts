export interface ContentReference {
  source: 'youtube-video' | 'ai-analysis' | 'saved-content';
  trendId: string;
  videoId?: string;
  regionCode: string;
  referenceTitle: string;
  category: string;
  channel?: string;
  tags?: string[];
  summary?: string;
}

export interface GenerateContentIdeasOptions {
  trendId: string;
  referenceVideoId?: string;
  regionCode: string;
  language: string;
  durationPreference: '5-8' | '8-10' | '10-15';
  additionalInstructions: string;
}

export interface ContentIdea {
  title: string;
  hook: string;
  angle: string;
  summary: string;
  targetAudience: string | null;
  ideaId: string;
  generationId: string;
  trendId: string;
  regionCode: string;
  language: string;
  durationPreference?: '5-8' | '8-10' | '10-15';
  additionalInstructions?: string;
}

export interface ScriptSection {
  title: string;
  narration: string;
}

export interface GeneratedScript {
  title: string;
  hook: string;
  introduction: string;
  sections: ScriptSection[];
  conclusion: string;
  estimatedDurationSeconds: number;
  researchRequired: boolean;
  researchNotes: string[];
  generationId: string;
  ideaId: string;
  language: string;
}

export interface GeneratedScene {
  order: number;
  narration: string;
  visualDescription: string;
  imagePrompt: string;
  estimatedDurationSeconds: number;
}

export interface GeneratedVideoPlan {
  title: string;
  totalEstimatedDurationSeconds: number;
  scenes: GeneratedScene[];
  generationId?: string;
}

export interface ContentGenerationContext {
  generationId: string;
  trendId: string;
  regionCode: string;
  language: string;
  trendSnapshot: {
    trend: {
      id: string;
      topic: string;
      keywords: string[];
      categories: string[];
      sources: string[];
      relevanceScore: number;
      items: Array<{ externalId: string; title: string; author: string; category?: string }>;
    };
    referenceVideo?: { externalId: string; title: string; author: string; category?: string };
    aiAnalysis?: unknown;
  };
  ideas: ContentIdea[];
  selectedIdea?: ContentIdea;
  script?: Omit<GeneratedScript, 'generationId' | 'ideaId' | 'language'>;
  videoPlan?: GeneratedVideoPlan;
  productionApproved: boolean;
}

export interface ContentGenerationListItem extends ContentGenerationContext {
  createdAt: string;
  updatedAt: string;
}

export interface ContentGenerationListResponse {
  items: ContentGenerationListItem[];
  total: number;
}
