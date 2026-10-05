export function sceneGenerationPrompt(language: string): string {
  return `Split the supplied narrated script into a sequence of short scenes for a future faceless video in ${language}.

Return scenes with order, narration, visualDescription, imagePrompt, and estimatedDurationSeconds. Preserve the script's spoken wording exactly in scene narration, in order, without adding or omitting claims. Keep each scene focused on one visual beat and usually between 3 and 15 seconds, never over 60 seconds.

visualDescription explains the footage or visual subject that supports the narration. imagePrompt is a standalone, descriptive text prompt for a future image model; it must not request text, captions, logos, or an actual image generation now. Do not add facts not present in the script. Output only the requested structured data in ${language}.`;
}
