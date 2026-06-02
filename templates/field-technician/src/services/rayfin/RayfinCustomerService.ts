import type { Customer } from '../../../rayfin/data/Customer';
import { ICustomerService } from '../interfaces/ICustomerService';
import { getRayfinClient } from './RayfinClientService';

export class RayfinCustomerService implements ICustomerService {
  async searchByPhone(phone: string): Promise<Customer[]> {
    const client = getRayfinClient();
    return client.data.Customer
      .select(['id', 'name', 'phone', 'email', 'address'])
      .where({ phone: { eq: phone } })
      .execute();
  }

  async getAllCustomers(): Promise<Customer[]> {
    const client = getRayfinClient();
    return client.data.Customer
      .select(['id', 'name', 'phone', 'email', 'address'])
      .orderBy({ name: 'asc' })
      .execute();
  }

  async createCustomer(data: {
    name: string;
    phone: string;
    email?: string;
    address?: string;
  }): Promise<Customer> {
    const client = getRayfinClient();
    return client.data.Customer.create(data);
  }

  async getCustomer(id: string): Promise<Customer | null> {
    const client = getRayfinClient();
    return client.data.Customer.findById(id);
  }
}
