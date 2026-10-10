import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  ContentProject,
  ProjectScene,
} from '../content-projects/content-project.schema';

export const VISUAL_STYLE_PRESETS = {
  DARK: 'Cinematic documentary storytelling. Consistent realistic visual language, atmospheric composition, purposeful dramatic lighting, natural readable colors. Mystery or tension only when appropriate. Daylight scenes remain bright and readable; dark storytelling does not mean black images. Avoid anime or illustration unless the scene explicitly requires it.',
};
export function sceneVisualFingerprint(
  project: ContentProject,
  scene: ProjectScene,
) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        topic: project.config.topic,
        style: project.config.style,
        narration: scene.narration,
        visualDescription: scene.visualDescription,
        imagePrompt: scene.imagePrompt,
      }),
    )
    .digest('hex');
}
@Injectable()
export class SceneImagePromptBuilder {
  build(project: ContentProject, scene: ProjectScene) {
    const index = project.scenes.findIndex((s) => s.id === scene.id);
    const aspectRatio = project.config.type === 'VIDEO' ? '16:9' : '1:1';
    return {
      aspectRatio: aspectRatio,
      style: project.config.style,
      prompt: [
        'Create one visual frame for a YouTube storytelling scene. No captions, watermarks or text overlays.',
        `Project topic: ${project.config.topic}`,
        `Visual style: ${VISUAL_STYLE_PRESETS[project.config.style]}`,
        `Composition: ${aspectRatio}; coherent framing and visual language throughout this project.`,
        `Narrative context (not text to display): ${scene.narration}`,
        `Visual description: ${scene.visualDescription}`,
        `Scene image prompt: ${scene.imagePrompt}`,
        project.scenes[index - 1]
          ? `Previous scene context: ${project.scenes[index - 1].visualDescription}`
          : '',
        project.scenes[index + 1]
          ? `Next scene context: ${project.scenes[index + 1].visualDescription}`
          : '',
        'Keep contextually appropriate lighting. Do not present invented evidence as authentic documentary evidence.',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }
}
