import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

interface ArticleAttributes {
  id: number;
  title: string;
  description: string;
  link: string;
  pubDate: Date;
  source: string;
  category: string[];
  imageUrl?: string;
  isFeatured: boolean;
  priority?: number;
  region?: string;
  titleHash?: string;
  lastSentAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

interface ArticleCreationAttributes extends Optional<ArticleAttributes, 'id' | 'isFeatured'> {}

class Article extends Model<ArticleAttributes, ArticleCreationAttributes> implements ArticleAttributes {
  public id!: number;
  public title!: string;
  public description!: string;
  public link!: string;
  public pubDate!: Date;
  public source!: string;
  public category!: string[];
  public imageUrl?: string;
  public isFeatured!: boolean;
  public priority?: number;
  public region?: string;
  public titleHash?: string;
  public lastSentAt?: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Article.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    link: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    pubDate: {
      type: DataTypes.DATE,
      allowNull: false
    },
    source: {
      type: DataTypes.STRING,
      allowNull: false
    },
    category: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: ['general']
    },
    imageUrl: {
      type: DataTypes.STRING,
      allowNull: true
    },
    isFeatured: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    priority: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: true
    },
    region: {
      type: DataTypes.STRING,
      allowNull: true
    },
    titleHash: {
      type: DataTypes.STRING(16),
      allowNull: true
    },
    lastSentAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  },
  {
    sequelize,
    tableName: 'articles',
    timestamps: true,
    indexes: [
      {
        fields: ['pubDate']
      },
      {
        fields: ['source']
      },
      {
        fields: ['priority']
      },
      {
        fields: ['region']
      },
      {
        fields: ['titleHash']
      },
      {
        fields: ['lastSentAt']
      }
    ]
  }
);

export default Article;
