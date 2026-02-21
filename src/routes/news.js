const express = require('express');
const router = express.Router();
const Article = require('../models/Article');
const { getFilterOptions } = require('../services/newsService');
const { triggerManualIngestion } = require('../jobs/cronJob');
const logger = require('../utils/logger');

/**
 * Build a MongoDB query object from request query params
 */
const buildQuery = (queryParams) => {
  const {
    startDate,
    endDate,
    author,
    language,
    country,
    category,
    datatype,
    search,
  } = queryParams;

  const query = {};

  // Date range filter
  if (startDate || endDate) {
    query.pubDate = {};
    if (startDate) {
      // date-only string "YYYY-MM-DD" → treat as UTC midnight
      query.pubDate.$gte = new Date(startDate + 'T00:00:00.000Z');
    }
    if (endDate) {
      // end of that day in UTC (23:59:59.999)
      query.pubDate.$lte = new Date(endDate + 'T23:59:59.999Z');
    }
  }

  // Author filter (case-insensitive partial match)
  if (author && author.trim()) {
    query.creator = { $elemMatch: { $regex: author.trim(), $options: 'i' } };
  }

  // Language filter
  if (language) {
    const langs = Array.isArray(language) ? language : language.split(',');
    query.language = { $in: langs.filter(Boolean) };
  }

  // Country filter
  if (country) {
    const countries = Array.isArray(country) ? country : country.split(',');
    query.country = { $in: countries.filter(Boolean) };
  }

  // Category multi-select (AND logic: article must have ALL selected categories)
  if (category) {
    const categories = Array.isArray(category) ? category : category.split(',');
    const filtered = categories.filter(Boolean);
    if (filtered.length > 0) {
      query.category = { $in: filtered };
    }
  }

  // Content type / datatype
  if (datatype) {
    const types = Array.isArray(datatype) ? datatype : datatype.split(',');
    query.datatype = { $in: types.filter(Boolean) };
  }

  // Full-text search
  if (search && search.trim()) {
    query.$text = { $search: search.trim() };
  }

  return query;
};

/**
 * GET /api/news/debug
 * Inspect stored pubDates and test a date range query — remove in production
 */
router.get('/debug', async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    const sample = await Article.find({}, { title: 1, pubDate: 1, pubDateTZ: 1 })
      .sort({ pubDate: -1 })
      .limit(10)
      .lean();

    const nullCount = await Article.countDocuments({ pubDate: null });
    const totalCount = await Article.countDocuments();

    let rangeResult = null;
    if (startDate && endDate) {
      const start = new Date(startDate + 'T00:00:00.000Z');
      const end = new Date(endDate + 'T23:59:59.999Z');
      rangeResult = {
        parsedStart: start.toISOString(),
        parsedEnd: end.toISOString(),
        matchCount: await Article.countDocuments({ pubDate: { $gte: start, $lte: end } }),
      };
    }

    res.json({
      totalArticles: totalCount,
      nullPubDateCount: nullCount,
      recentSample: sample.map((a) => ({
        title: a.title?.slice(0, 60),
        pubDate: a.pubDate,
        pubDateTZ: a.pubDateTZ,
      })),
      rangeTest: rangeResult,
    });
  } catch (error) {
    next(error);
  }
});


router.get('/', async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      sortBy = 'pubDate',
      sortOrder = 'desc',
      search,
      ...filters
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const query = buildQuery({ ...filters, search });

    const sortDir = sortOrder === 'asc' ? 1 : -1;
    const sortOptions = { [sortBy]: sortDir };
    if (sortBy !== 'pubDate') sortOptions.pubDate = -1;

    // Use projection to avoid sending huge content in list view
    const projection = {
      article_id: 1,
      title: 1,
      description: 1,
      link: 1,
      creator: 1,
      pubDate: 1,
      source_name: 1,
      source_icon: 1,
      image_url: 1,
      category: 1,
      country: 1,
      language: 1,
      datatype: 1,
      sentiment: 1,
    };

    const [articles, total] = await Promise.all([
      Article.find(query, projection)
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Article.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: articles,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
        hasNextPage: pageNum < Math.ceil(total / limitNum),
        hasPrevPage: pageNum > 1,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/news/filters
 * Get distinct values for all filter dropdowns
 */
router.get('/filters', async (req, res, next) => {
  try {
    const options = await getFilterOptions();
    res.json({ success: true, data: options });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/news/stats
 * Dashboard stats
 */
router.get('/stats', async (req, res, next) => {
  try {
    const [total, last24h, byCategory, byLanguage] = await Promise.all([
      Article.countDocuments(),
      Article.countDocuments({ pubDate: { $gte: new Date(Date.now() - 86400000) } }),
      Article.aggregate([
        { $unwind: '$category' },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      Article.aggregate([
        { $group: { _id: '$language', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
    ]);

    res.json({
      success: true,
      data: { total, last24h, byCategory, byLanguage },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/news/:id
 * Single article by article_id
 */
router.get('/:id', async (req, res, next) => {
  try {
    const article = await Article.findOne({ article_id: req.params.id }).lean();

    if (!article) {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }

    res.json({ success: true, data: article });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/news/ingest (admin/manual trigger)
 */
router.post('/ingest', async (req, res, next) => {
  try {
    const result = await triggerManualIngestion();
    res.json({ success: true, message: 'Ingestion complete', data: result });
  } catch (error) {
    if (error.message === 'Ingestion already in progress') {
      return res.status(409).json({ success: false, message: error.message });
    }
    next(error);
  }
});

module.exports = router;
