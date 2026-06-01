import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

interface NewsSourceAttributes {
  id: number;
  url: string;
  source: string;
  category: string[];
  region?: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface NewsSourceCreationAttributes extends Optional<NewsSourceAttributes, 'id' | 'isActive'> {}

class NewsSource extends Model<NewsSourceAttributes, NewsSourceCreationAttributes> implements NewsSourceAttributes {
  declare public id: number;
  declare public url: string;
  declare public source: string;
  declare public category: string[];
  declare public region?: string;
  declare public isActive: boolean;
  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;
}

NewsSource.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    url: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    source: {
      type: DataTypes.STRING,
      allowNull: false
    },
    category: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: ['space', 'news']
    },
    region: {
      type: DataTypes.STRING,
      allowNull: true
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  },
  {
    sequelize,
    tableName: 'news_sources',
    timestamps: true,
    indexes: [
      {
        fields: ['isActive']
      },
      {
        fields: ['source']
      }
    ]
  }
);

export default NewsSource;
