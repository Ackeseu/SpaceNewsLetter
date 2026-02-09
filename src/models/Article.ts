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
      }
    ]
  }
);

export default Article;
