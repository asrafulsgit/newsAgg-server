const mongoose = require("mongoose");

const articleSchema = new mongoose.Schema(
  {
    article_id: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    link: {
      type: String,
      trim: true,
    },
    keywords: {
      type: [String],
      default: [],
    },
    creator: { type: [String], default: [] },
    video_url: String,
    description: {
      type: String,
      trim: true,
    },
    content: {
      type: String,
      trim: true,
    },
    pubDate: {
      type: Date,
      index: true,
    },
    pubDateTZ: String,
    image_url: String,
    source_id: {
      type: String,
      index: true,
    },
    source_name: String,
    source_url: String,
    source_icon: String,
    source_priority: Number,
    country: {
      type: [String],
      index: true,
    },
    category: {
      type: [String],
      index: true,
    },
    language: {
      type: String,
      index: true,
    },
    ai_tag: [String],
    sentiment: String,
    sentiment_stats: mongoose.Schema.Types.Mixed,
    ai_region: [String],
    ai_org: [String],
    duplicate: Boolean,
    datatype: {
      type: String,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Compound indexes for common query patterns
articleSchema.index({ pubDate: -1, language: 1 });
articleSchema.index({ pubDate: -1, category: 1 });
articleSchema.index({ pubDate: -1, country: 1 });
articleSchema.index({ creator: 1, pubDate: -1 });
articleSchema.index({ title: "text", description: "text", content: "text" });

const Article = mongoose.model("Article", articleSchema);

module.exports = Article;
