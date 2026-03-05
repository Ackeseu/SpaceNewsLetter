import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

interface NewsletterDeliveryLogAttributes {
  id: number;
  email: string;
  triggerType: 'scheduled' | 'test';
  frequency?: 'daily' | 'weekly' | 'monthly' | null;
  success: boolean;
  errorMessage?: string | null;
  articleCount: number;
  deliveredAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

interface NewsletterDeliveryLogCreationAttributes
  extends Optional<NewsletterDeliveryLogAttributes, 'id' | 'frequency' | 'errorMessage' | 'articleCount' | 'deliveredAt'> {}

class NewsletterDeliveryLog
  extends Model<NewsletterDeliveryLogAttributes, NewsletterDeliveryLogCreationAttributes>
  implements NewsletterDeliveryLogAttributes {
  public id!: number;
  public email!: string;
  public triggerType!: 'scheduled' | 'test';
  public frequency?: 'daily' | 'weekly' | 'monthly' | null;
  public success!: boolean;
  public errorMessage?: string | null;
  public articleCount!: number;
  public deliveredAt!: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

NewsletterDeliveryLog.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        isEmail: true
      }
    },
    triggerType: {
      type: DataTypes.ENUM('scheduled', 'test'),
      allowNull: false
    },
    frequency: {
      type: DataTypes.ENUM('daily', 'weekly', 'monthly'),
      allowNull: true
    },
    success: {
      type: DataTypes.BOOLEAN,
      allowNull: false
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    articleCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    deliveredAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  },
  {
    sequelize,
    tableName: 'newsletter_delivery_logs',
    timestamps: true,
    indexes: [
      { fields: ['email'] },
      { fields: ['deliveredAt'] },
      { fields: ['email', 'deliveredAt'] }
    ]
  }
);

export default NewsletterDeliveryLog;
