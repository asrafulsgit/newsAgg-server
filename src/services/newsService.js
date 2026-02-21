const axios = require('axios');
const Article = require('../models/Article');
const logger = require('../utils/logger');

const BASE_URL = process.env.NEWSDATA_BASE_URL || 'https://newsdata.io/api/1';
const API_KEY = process.env.NEWSDATA_API_KEY;

/**
 * Fetch a single page of news from NewsData.io
 */
const fetchNewsPage = async (params = {}) => {
  const response = await axios.get(`${BASE_URL}/news`, {
    params: {
      apikey: API_KEY,
      ...params,
    },
    timeout: 30000,
  });
  return response.data;
};

/**
 * Upsert articles into MongoDB. Uses article_id as the unique key.
 * Returns counts of new and updated articles.
 */
const upsertArticles = async (articles) => {
  if (!articles || articles.length === 0) return { upserted: 0, modified: 0 };

  const ops = articles.map((article) => {
    // Explicitly parse pubDate string → proper JS Date object
    // NewsData.io format: "2026-02-20 17:45:00" (UTC, space separator)
    let parsedDate = null;
    if (article.pubDate) {
      const iso = String(article.pubDate).replace(' ', 'T') + 'Z';
      const d = new Date(iso);
      parsedDate = isNaN(d.getTime()) ? null : d;
    }

    return {
      updateOne: {
        filter: { article_id: article.article_id },
        update: {
          $set: {
            title: article.title,
            link: article.link,
            keywords: article.keywords || [],
            creator: article.creator || [],
            video_url: article.video_url || null,
            description: article.description || null,
            content: article.content || null,
            pubDate: parsedDate,
            pubDateTZ: article.pubDateTZ || null,
            image_url: article.image_url || null,
            source_id: article.source_id || null,
            source_name: article.source_name || null,
            source_url: article.source_url || null,
            source_icon: article.source_icon || null,
            source_priority: article.source_priority || null,
            country: article.country || [],
            category: article.category || [],
            language: article.language || null,
            ai_tag: article.ai_tag || [],
            sentiment: article.sentiment || null,
            sentiment_stats: article.sentiment_stats || null,
            ai_region: article.ai_region || [],
            ai_org: article.ai_org || [],
            duplicate: article.duplicate || false,
            datatype: article.datatype || null,
          },
        },
        upsert: true,
      },
    };
  });

  const result = await Article.bulkWrite(ops, { ordered: false });
  return {
    upserted: result.upsertedCount,
    modified: result.modifiedCount,
  };
};

/**
 * Main ingestion pipeline: fetch all pages and store to DB.
 * Batches categories in groups of 5 (NewsData.io limit per request).
 */
const ingestNews = async () => {
  if (!API_KEY) {
    logger.error('NEWSDATA_API_KEY is not set. Skipping ingestion.');
    return;
  }

  const allCategories = (process.env.NEWS_FETCH_CATEGORIES || 'technology,business,science')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  const language = process.env.NEWS_FETCH_LANGUAGE || 'en';

  // NewsData.io max = 5 categories per request — chunk them
  const CATEGORY_BATCH_SIZE = 5;
  const categoryBatches = [];
  for (let i = 0; i < allCategories.length; i += CATEGORY_BATCH_SIZE) {
    categoryBatches.push(allCategories.slice(i, i + CATEGORY_BATCH_SIZE));
  }

  let totalUpserted = 0;
  let totalModified = 0;
  let totalPages = 0;
  const MAX_PAGES = 3; // Per category batch

  logger.info(`Starting news ingestion: ${allCategories.length} categories in ${categoryBatches.length} batch(es)`);

  try {
    for (const batch of categoryBatches) {
      const categoryParam = batch.join(',');
      logger.debug(`Fetching batch: [${categoryParam}]`);

      let page = null;
      let pageCount = 0;

      do {
        const params = {
          language,
          category: categoryParam,
          ...(page ? { page } : {}),
        };

        const data = await fetchNewsPage(params);

        if (data.status !== 'success') {
          logger.error(`NewsData API error for batch [${categoryParam}]: ${JSON.stringify(data)}`);
          break;
        }

        const articles = data.results || [];
        logger.debug(`  Fetched ${articles.length} articles (page ${pageCount + 1})`);

        const { upserted, modified } = await upsertArticles(articles);
        totalUpserted += upserted;
        totalModified += modified;

        page = data.nextPage || null;
        pageCount++;
        totalPages++;

        // Delay between pages to respect rate limits
        if (page && pageCount < MAX_PAGES) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      } while (page && pageCount < MAX_PAGES);

      // Delay between category batches
      if (categoryBatches.indexOf(batch) < categoryBatches.length - 1) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    logger.info(
      `Ingestion complete. Total pages: ${totalPages}, New: ${totalUpserted}, Updated: ${totalModified}`
    );

    return { pages: totalPages, upserted: totalUpserted, modified: totalModified };
  } catch (error) {
    if (error.response) {
      logger.error(`NewsData API HTTP error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    } else {
      logger.error(`News ingestion error: ${error.message}`);
    }
    throw error;
  }
};

/**
 * Get distinct values for filter dropdowns
 */
const getFilterOptions = async () => {
  const [languages, countries, categories, datatypes, authors] = await Promise.all([
    Article.distinct('language').then((vals) => vals.filter(Boolean).sort()),
    Article.distinct('country').then((vals) => vals.flat().filter(Boolean).sort()),
    Article.distinct('category').then((vals) => vals.flat().filter(Boolean).sort()),
    Article.distinct('datatype').then((vals) => vals.filter(Boolean).sort()),
    Article.distinct('creator').then((vals) => vals.flat().filter(Boolean).sort().slice(0, 200)),
  ]);

  return { languages, countries, categories, datatypes, authors };
};

module.exports = { ingestNews, getFilterOptions };