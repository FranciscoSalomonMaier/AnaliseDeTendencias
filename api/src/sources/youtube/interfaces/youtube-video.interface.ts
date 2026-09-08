export interface YouTubeVideo {
  id: string;

  snippet: {
    title: string;
    description?: string;
    channelTitle: string;
    publishedAt: string;
    categoryId?: string;
    tags?: string[];

    thumbnails?: {
      high?: {
        url: string;
      };
    };
  };

  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };

  numberView?: string;
  categoryTitle?: string;
}