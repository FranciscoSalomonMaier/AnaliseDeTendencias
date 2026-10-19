import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSceneTimestamps } from './contentStudioTime.js';
test('uses effective audio timeline when available and keeps estimates otherwise', () => {
 const scenes=[{id:'a',estimatedDurationSeconds:10},{id:'b',estimatedDurationSeconds:20}];
 assert.deepEqual(calculateSceneTimestamps(scenes),[{startSeconds:0,endSeconds:10},{startSeconds:10,endSeconds:30}]);
 assert.deepEqual(calculateSceneTimestamps(scenes,{scenes:[{sceneId:'a',startSeconds:0,endSeconds:3.3},{sceneId:'b',startSeconds:3.3,endSeconds:7.6}]}),[{startSeconds:0,endSeconds:3.3,estimated:false},{startSeconds:3.3,endSeconds:7.6,estimated:false}]);
});
