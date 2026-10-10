import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('topics page, cards and period requests', async (t) => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { TrendingTopics } = await server.ssrLoadModule('/src/pages/TrendingTopics/TrendingTopics.jsx');
    const { TopicCard } = await server.ssrLoadModule('/src/pages/TrendingTopics/TopicCard.jsx');
    const { getTrendingTopics } = await server.ssrLoadModule('/src/services/trendingTopicsService.js');
    await t.test('initial loading and period controls render', () => {
      const html = renderToStaticMarkup(createElement(TrendingTopics));
      assert.match(html, /Carregando temas/);
      for (const label of ['Hoje', '7 dias', '30 dias', '1 ano']) assert.ok(html.includes(label));
    });
    await t.test('topic ranking, partial badge and expandable videos render', () => {
      const topic = {id:'gta',name:'GTA 6',videoCount:17,totalViews:'42800000',viewsInPeriod:'8400000',keywords:['Rockstar','Gameplay'],hasFullPeriodData:false,actualHistorySeconds:7200,capturedAt:'2026-10-05T00:00:00Z',topVideos:[{id:'a',title:'GTA Trailer',channelTitle:'Rockstar',thumbnail:'https://example.test/thumb.jpg',currentViews:'1000000',viewsInPeriod:'500000',hasFullPeriodData:false,actualHistorySeconds:7200}]};
      const html = renderToStaticMarkup(createElement(TopicCard, { topic, index:0, shownPeriod:'7d' }));
      for (const text of ['#1','GTA 6','17 vídeos relacionados','Dados parciais','2 h','GTA Trailer','Rockstar','Criar conteúdo']) assert.ok(html.includes(text), text);
      assert.match(html, /<details/);
      assert.match(html, /<summary[^>]*>Ver vídeos/);
      assert.match(html, /youtube.com\/watch\?v=a/);
      assert.doesNotMatch(html, /disabled/);
    });
    const originalFetch = globalThis.fetch;
    try {
      await t.test('period selection sends distinct parameters and cancellation signal', async () => {
        const calls = [];
        globalThis.fetch = async (url, options) => { calls.push({url, options});return {ok:true,json:async()=>({topics:[]})}; };
        const controller = new AbortController();
        for (const period of ['today','7d','30d','1y']) await getTrendingTopics({period,signal:controller.signal});
        assert.equal(calls.length,4);
        assert.deepEqual(calls.map(({url})=>new URL(url,'http://local.test').searchParams.get('period')), ['today','7d','30d','1y']);
        assert.ok(calls.every(call=>call.options.signal===controller.signal));
      });
      await t.test('service reports errors and preserves empty response', async () => {
        globalThis.fetch = async () => ({ok:false});
        await assert.rejects(getTrendingTopics(), /Não foi possível carregar/);
        globalThis.fetch = async () => ({ok:true,json:async()=>({period:'today',topics:[]})});
        assert.deepEqual(await getTrendingTopics(), {period:'today',topics:[]});
      });
    } finally { globalThis.fetch=originalFetch; }
  } finally { await server.close(); }
});
