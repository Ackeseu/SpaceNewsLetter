import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

interface ArticleTopicSendStatAttributes {
  id: number;
  topicFingerprint: string;
  sendCount: number;
  lastSentAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface ArticleTopicSendStatCreationAttributes
  extends Optional<ArticleTopicSendStatAttributes, 'id' | 'sendCount' | 'lastSentAt'> {}

class ArticleTopicSendStat
  extends Model<ArticleTopicSendStatAttributes, ArticleTopicSendStatCreationAttributes>
  implements ArticleTopicSendStatAttributes {
  public id!: number;
  public topicFingerprint!: string;
  public sendCount!: number;
  public lastSentAt?: Date | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

ArticleTopicSendStat.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    topicFingerprint: {
      type: DataTypes.STRING(256),
      allowNull: false,
      unique: true
    },
    sendCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    lastSentAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  },
  {
    sequelize,
    tableName: 'article_topic_send_stats',
    timestamps: true,
    indexes: [
      { fields: ['topicFingerprint'] },
      { fields: ['sendCount'] },
      { fields: ['lastSentAt'] }
    ]
  }
);

export default ArticleTopicSendStat;
