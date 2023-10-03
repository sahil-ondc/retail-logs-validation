/* eslint-disable no-case-declarations */
/* eslint-disable no-prototype-builtins */
import { logger } from '../../../shared/logger'
import { setValue, getValue } from '../../../shared/dao'
import constants, { ApiSequence } from '../../../constants'
import { validateSchema, isObjectEmpty, checkContext, timeDiff, checkGpsPrecision, emailRegex } from '../../../utils'
import _ from 'lodash'

export const checkOnsearchFullCatalogRefresh = (data: any, msgIdSet: any) => {
  if (!data || isObjectEmpty(data)) {
    return { [ApiSequence.ON_SEARCH]: 'Json cannot be empty' }
  }

  const { message, context } = data
  if (!message || !context || !message.catalog || isObjectEmpty(message) || isObjectEmpty(message.catalog)) {
    return { missingFields: '/context, /message, /catalog or /message/catalog is missing or empty' }
  }

  const schemaValidation = validateSchema('RET11', constants.RET_ONSEARCH, data)

  const contextRes: any = checkContext(context, constants.RET_ONSEARCH)
  setValue(ApiSequence.ON_SEARCH, context)
  msgIdSet.add(context.message_id)

  const errorObj: any = {}

  if (schemaValidation !== 'error') {
    Object.assign(errorObj, schemaValidation)
  }

  if (!contextRes?.valid) {
    Object.assign(errorObj, contextRes.ERRORS)
  }

  const searchContext: any = getValue(ApiSequence.SEARCH)

  try {
    logger.info(`Storing BAP_ID and BPP_ID in /${constants.RET_ONSEARCH}`)
    setValue('bapId', context.bap_id)
    setValue('bppId', context.bpp_id)
  } catch (error: any) {
    logger.error(`!!Error while storing BAP and BPP Ids in /${constants.RET_ONSEARCH}, ${error.stack}`)
  }

  try {
    logger.info(`Comparing timestamp of /${constants.RET_SEARCH} and /${constants.RET_ONSEARCH}`)
    if (_.gte(searchContext?.timestamp, context.timestamp)) {
      errorObj.timestamp = `Context timestamp for /${constants.RET_SEARCH} api cannot be greater than or equal to /${constants.RET_ONSEARCH} api`
    } else {
      const timeDifference: any = timeDiff(context.timestamp, searchContext?.timestamp)
      logger.info(timeDiff)
      if (timeDifference > 5000) {
        errorObj.timestamp = `context/timestamp difference between /${constants.RET_ONSEARCH} and /${constants.RET_SEARCH} should be smaller than 5 sec`
      }
    }

    setValue('on_searchTimeStamp', context.timestamp)
  } catch (error) {
    logger.info(`Error while comparing timestamp for /${constants.RET_SEARCH} and /${constants.RET_ONSEARCH} api`)
  }

  try {
    logger.info(`Comparing transaction Ids of /${constants.RET_SEARCH} and /${constants.RET_ONSEARCH}`)
    if (!_.isEqual(searchContext.transaction_id, context.transaction_id)) {
      errorObj.transaction_id = `Transaction Id for /${constants.RET_SEARCH} and /${constants.RET_ONSEARCH} api should be same`
    }
  } catch (error: any) {
    logger.info(
      `Error while comparing transaction ids for /${constants.RET_SEARCH} and /${constants.RET_ONSEARCH} api, ${error.stack}`,
    )
  }

  try {
    logger.info(`Comparing Message Ids of /${constants.RET_SEARCH} and /${constants.RET_ONSEARCH}`)
    if (!_.isEqual(searchContext.message_id, context.message_id)) {
      errorObj.message_id = `Message Id for /${constants.RET_SEARCH} and /${constants.RET_ONSEARCH} api should be same`
    }

    msgIdSet.add(context.message_id)
  } catch (error: any) {
    logger.info(
      `Error while comparing message ids for /${constants.RET_SEARCH} and /${constants.RET_ONSEARCH} api, ${error.stack}`,
    )
  }

  const onSearchCatalog: any = message.catalog
  const onSearchFFIds = new Set()
  const prvdrsId = new Set()

  try {
    logger.info(`Saving static fulfillment ids in /${constants.RET_ONSEARCH}`)

    let i = 0
    const bppFF = onSearchCatalog['bpp/fulfillments']
    const len = bppFF.length
    while (i < len) {
      onSearchFFIds.add(bppFF[i].id)
      i++
    }
  } catch (error: any) {
    logger.info(`Error while saving static fulfillment ids in /${constants.RET_ONSEARCH}, ${error.stack}`)
  }

  try {
    logger.info(`Checking Providers info (bpp/providers) in /${constants.RET_ONSEARCH}`)
    let i = 0
    const bppPrvdrs = onSearchCatalog['bpp/providers']
    const len = bppPrvdrs.length
    const tmpstmp = context.timestamp
    while (i < len) {
      const itemsId = new Set()
      const prvdrLocId = new Set()
      const ctgryId = new Set()
      const categoriesId = new Set()

      logger.info(`Validating uniqueness for provider id in bpp/providers[${i}]...`)
      const prvdr = bppPrvdrs[i]

      if (prvdrsId.has(prvdr.id)) {
        const key = `prvdr${i}id`
        errorObj[key] = `duplicate provider id: ${prvdr.id} in bpp/providers`
      } else {
        prvdrsId.add(prvdr.id)
      }

      logger.info(`Checking store enable/disable timestamp in bpp/providers[${i}]`)
      const providerTime = new Date(prvdr.time.timestamp).getTime()
      const contextTimestamp = new Date(tmpstmp).getTime()

      if (providerTime > contextTimestamp) {
        errorObj.StoreEnableDisable = `store enable/disable timestamp (/bpp/providers/time/timestamp) should be less then or equal to context.timestamp`
      }

      logger.info(`Checking store timings in bpp/providers[${i}]`)

      prvdr.locations.forEach((loc: any, iter: any) => {
        try {
          logger.info(`Checking gps precision of store location in /bpp/providers[${i}]/locations[${iter}]`)
          const has = Object.prototype.hasOwnProperty
          if (has.call(loc, 'gps')) {
            if (!checkGpsPrecision(loc.gps)) {
              errorObj.gpsPrecision = `/bpp/providers[${i}]/locations[${iter}]/gps coordinates must be specified with at least six decimal places of precision.`
            }
          }
        } catch (error) {
          logger.error(
            `!!Error while checking gps precision of store location in /bpp/providers[${i}]/locations[${iter}]`,
            error,
          )
        }

        if (prvdrLocId.has(loc.id)) {
          const key = `prvdr${i}${loc.id}${iter}`
          errorObj[key] = `duplicate location id: ${loc.id} in /bpp/providers[${i}]/locations[${iter}]`
        } else {
          prvdrLocId.add(loc.id)
        }

        logger.info('Checking store days...')
        const days = loc.time.days.split(',')
        days.forEach((day: any) => {
          day = parseInt(day)
          if (isNaN(day) || day < 1 || day > 7) {
            const key = `prvdr${i}locdays${iter}`
            errorObj[
              key
            ] = `store days (bpp/providers[${i}]/locations[${iter}]/time/days) should be in the format ("1,2,3,4,5,6,7") where 1- Monday and 7- Sunday`
          }
        })

        logger.info('Checking fixed or split timings')
        //scenario 1: range =1 freq/times =1
        if (loc.time.range && (loc.time.schedule.frequency || loc.time.schedule.times)) {
          const key = `prvdr${i}loctime${iter}`
          errorObj[
            key
          ] = `Either one of fixed (range) or split (frequency and times) timings should be provided in /bpp/providers[${i}]/locations[${iter}]/time`
        }

        // scenario 2: range=0 freq || times =1
        if (!loc.time.range && (!loc.time.schedule.frequency || !loc.time.schedule.times)) {
          const key = `prvdr${i}loctime${iter}`
          errorObj[
            key
          ] = `Either one of fixed timings (range) or split timings (both frequency and times) should be provided in /bpp/providers[${i}]/locations[${iter}]/time`
        }

        //scenario 3: range=1 (start and end not compliant) frequency=0;
        if ('range' in loc.time) {
          logger.info('checking range (fixed timings) start and end')
          const startTime: any = 'start' in loc.time.range ? parseInt(loc.time.range.start) : ''
          const endTime: any = 'end' in loc.time.range ? parseInt(loc.time.range.end) : ''
          if (isNaN(startTime) || isNaN(endTime) || startTime > endTime || endTime > 2359) {
            errorObj.startEndTime = `end time must be greater than start time in fixed timings /locations/time/range (fixed store timings)`
          }
        }
      })

      try {
        logger.info(`Checking items for provider (${prvdr.id}) in bpp/providers[${i}]`)
        let j = 0
        const items = onSearchCatalog['bpp/providers'][i]['items']
        const iLen = items.length
        while (j < iLen) {
          logger.info(`Validating uniqueness for item id in bpp/providers[${i}].items[${j}]...`)
          const item = items[j]

          if (itemsId.has(item.id)) {
            const key = `prvdr${i}item${j}`
            errorObj[key] = `duplicate item id: ${item.id} in bpp/providers[${i}]`
          } else {
            itemsId.add(item.id)
          }

          logger.info(`Checking available and maximum count for item id: ${item.id}`)
          if ('available' in item.quantity && 'maximum' in item.quantity) {
            const avlblCnt = parseInt(item.quantity.available.count)
            const mxCnt = parseInt(item.quantity.maximum.count)

            if (avlblCnt > mxCnt) {
              const key = `prvdr${i}item${j}Cnt`
              errorObj[
                key
              ] = `available count of item should be smaller or equal to the maximum count (/bpp/providers[${i}]/items[${j}]/quantity)`
            }
          }

          logger.info(`Checking selling price and maximum price for item id: ${item.id}`)

          if ('price' in item) {
            const sPrice = parseFloat(item.price.value)
            const maxPrice = parseFloat(item.price.maximum_value)

            if (sPrice > maxPrice) {
              const key = `prvdr${i}item${j}Price`
              errorObj[
                key
              ] = `selling price of item /price/value with id: (${item.id}) can't be greater than the maximum price /price/maximum_value in /bpp/providers[${i}]/items[${j}]/`
            }
          }

          logger.info(`Checking category_id for item id: ${item.id}`)
          if ('category_id' in item) {
            ctgryId.add(item.category_id)
            const categoryList = [
              'F&B',
              'Continental',
              'Middle Eastern',
              'North Indian',
              'Pan-Asian',
              'Regional Indian',
              'South Indian',
              'Tex-Mexican',
              'World Cuisines',
              'Healthy Food',
              'Fast Food',
              'Desserts',
              'Bakes & Cakes',
              'Beverages (MTO)',
              'Gourmet & World Foods',
              'Beverages',
              'Bakery, Cakes & Dairy',
              'Snacks & Branded Foods',
            ]
            try {
              if (categoryList.includes(item.category_id)) {
                if (!prvdr['@ondc/org/fssai_license_no']) {
                  errorObj.fssaiLiceNo = `@ondc/org/fssai_license_no is mandatory for category_id ${item.category_id}`
                } else if (prvdr.hasOwnProperty('@ondc/org/fssai_license_no')) {
                  if (prvdr['@ondc/org/fssai_license_no'].length != 14) {
                    errorObj.fssaiLiceNo = `@ondc/org/fssai_license_no must contain a valid 14 digit FSSAI No.`
                  }
                }
              }
            } catch (error) {
              logger.info(`!!Error occurred while checking fssai license no for provider ${prvdr.id}`)
            }
          }

          logger.info(`Checking fulfillment_id for item id: ${item.id}`)

          if (item.fulfillment_id && !onSearchFFIds.has(item.fulfillment_id)) {
            const key = `prvdr${i}item${j}ff`
            errorObj[
              key
            ] = `fulfillment_id in /bpp/providers[${i}]/items[${j}] should map to one of the fulfillments id in bpp/fulfillments`
          }

          logger.info(`Checking location_id for item id: ${item.id}`)

          if (item.location_id && !prvdrLocId.has(item.location_id)) {
            const key = `prvdr${i}item${j}loc`
            errorObj[
              key
            ] = `location_id in /bpp/providers[${i}]/items[${j}] should be one of the locations id in /bpp/providers[${i}]/locations`
          }

          logger.info(`Checking consumer care details for item id: ${item.id}`)
          if ('@ondc/org/contact_details_consumer_care' in item) {
            let consCare = item['@ondc/org/contact_details_consumer_care']
            consCare = consCare.split(',')
            if (consCare.length < 3) {
              const key = `prvdr${i}consCare`
              errorObj[
                key
              ] = `@ondc/org/contact_details_consumer_care should be in the format "name,email,contactno" in /bpp/providers[${i}]/items`
            } else {
              const checkEmail: boolean = emailRegex(consCare[1].trim())
              if (isNaN(consCare[2].trim()) || !checkEmail) {
                const key = `prvdr${i}consCare`
                errorObj[
                  key
                ] = `@ondc/org/contact_details_consumer_care should be in the format "name,email,contactno" in /bpp/providers[${i}]/items`
              }
            }
          }

          j++
        }
      } catch (error: any) {
        logger.error(`!!Errors while checking items in bpp/providers[${i}], ${error.stack}`)
      }

      try {
        logger.info(`Checking serviceability construct for bpp/providers[${i}]`)

        const tags = onSearchCatalog['bpp/providers'][i]['tags']
        //checking for each serviceability construct
        tags.forEach((sc: any, t: any) => {
          if ('list' in sc) {
            if (sc.list.length != 5) {
              const key = `prvdr${i}tags${t}`
              errorObj[
                key
              ] = `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract`
            }

            //checking location
            const loc = sc.list.find((elem: any) => elem.code === 'location') || ''
            if (!loc) {
              const key = `prvdr${i}tags${t}loc`
              errorObj[
                key
              ] = `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract (location is missing)`
            } else {
              if ('value' in loc) {
                if (!prvdrLocId.has(loc.value)) {
                  const key = `prvdr${i}tags${t}loc`
                  errorObj[
                    key
                  ] = `location in serviceability construct should be one of the location ids bpp/providers[${i}]/locations`
                }
              } else {
                const key = `prvdr${i}tags${t}loc`
                errorObj[
                  key
                ] = `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract (location is missing)`
              }
            }

            //checking category
            const ctgry = sc.list.find((elem: any) => elem.code === 'category') || ''
            if (!ctgry) {
              const key = `prvdr${i}tags${t}ctgry`
              errorObj[
                key
              ] = `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract (category is missing)`
            } else {
              if ('value' in ctgry) {
                if (!ctgryId.has(ctgry.value)) {
                  const key = `prvdr${i}tags${t}ctgry`
                  errorObj[
                    key
                  ] = `category in serviceability construct should be one of the category ids bpp/providers[${i}]/items/category_id`
                }
              } else {
                const key = `prvdr${i}tags${t}ctgry`
                errorObj[
                  key
                ] = `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract (category is missing)`
              }
            }

            //checking type (hyperlocal, intercity or PAN India)
            const type = sc.list.find((elem: any) => elem.code === 'type') || ''
            if (!type) {
              const key = `prvdr${i}tags${t}type`
              errorObj[
                key
              ] = `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract (type is missing)`
            } else {
              if ('value' in type) {
                switch (type.value) {
                  case '10':
                    {
                      //For hyperlocal

                      //checking value
                      const val = sc.list.find((elem: any) => elem.code === 'val') || ''
                      if ('value' in val) {
                        if (isNaN(val.value)) {
                          const key = `prvdr${i}tags${t}valvalue`
                          errorObj[
                            key
                          ] = `value should be a number (code:"val") for type 10 (hyperlocal) in /bpp/providers[${i}]/tags[${t}]`
                        }
                      } else {
                        const key = `prvdr${i}tags${t}val`
                        errorObj[
                          key
                        ] = `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract (value is missing for code "val")`
                      }

                      //checking unit
                      const unit = sc.list.find((elem: any) => elem.code === 'unit') || ''
                      if ('value' in unit) {
                        if (unit.value != 'km') {
                          const key = `prvdr${i}tags${t}unitvalue`
                          errorObj[
                            key
                          ] = `value should be "km" (code:"unit") for type 10 (hyperlocal) in /bpp/providers[${i}]/tags[${t}]`
                        }
                      } else {
                        const key = `prvdr${i}tags${t}unit`
                        errorObj[
                          key
                        ] = `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract (value is missing for code "unit")`
                      }
                    }

                    break
                  case '11':
                    {
                      //intercity

                      //checking value
                      const val = sc.list.find((elem: any) => elem.code === 'val') || ''
                      if ('value' in val) {
                        const pincodes = val.value.split(/,|-/)
                        pincodes.forEach((pincode: any) => {
                          if (isNaN(pincode) || pincode.length != 6) {
                            const key = `prvdr${i}tags${t}valvalue`
                            errorObj[
                              key
                            ] = `value should be a valid range of pincodes (code:"val") for type 11 (intercity) in /bpp/providers[${i}]/tags[${t}]`
                          }
                        })
                      } else {
                        const key = `prvdr${i}tags${t}val`
                        errorObj[
                          key
                        ] = `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract (value is missing for code "val")`
                      }

                      //checking unit
                      const unit = sc.list.find((elem: any) => elem.code === 'unit') || ''
                      if ('value' in unit) {
                        if (unit.value != 'pincode') {
                          const key = `prvdr${i}tags${t}unitvalue`
                          errorObj[
                            key
                          ] = `value should be "pincode" (code:"unit") for type 11 (intercity) in /bpp/providers[${i}]/tags[${t}]`
                        }
                      } else {
                        const key = `prvdr${i}tags${t}unit`
                        errorObj[
                          key
                        ] = `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract (value is missing for code "unit")`
                      }
                    }

                    break
                  case '12':
                    {
                      //PAN India

                      //checking value
                      const val = sc.list.find((elem: any) => elem.code === 'val') || ''
                      if ('value' in val) {
                        if (val.value != 'IND') {
                          const key = `prvdr${i}tags${t}valvalue`
                          errorObj[
                            key
                          ] = `value should be "IND" (code:"val") for type 12 (PAN India) in /bpp/providers[${i}]tags[${t}]`
                        }
                      } else {
                        const key = `prvdr${i}tags${t}val`
                        errorObj[
                          key
                        ] = `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract (value is missing for code "val")`
                      }

                      //checking unit
                      const unit = sc.list.find((elem: any) => elem.code === 'unit') || ''
                      if ('value' in unit) {
                        if (unit.value != 'country') {
                          const key = `prvdr${i}tags${t}unitvalue`
                          errorObj[
                            key
                          ] = `value should be "country" (code:"unit") for type 12 (PAN India) in /bpp/providers[${i}]tags[${t}]`
                        }
                      } else {
                        const key = `prvdr${i}tags${t}unit`
                        errorObj[
                          key
                        ] = `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract (value is missing for code "unit")`
                      }
                    }

                    break
                  default: {
                    const key = `prvdr${i}tags${t}type`
                    errorObj[
                      key
                    ] = `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract (invalid type "${type.value}")`
                  }
                }
              } else {
                const key = `prvdr${i}tags${t}type`
                errorObj[
                  key
                ] = `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract (type is missing)`
              }
            }
          }
        })
      } catch (error: any) {
        logger.error(`!!Error while checking serviceability construct for bpp/providers[${i}], ${error.stack}`)
      }

      try {
        logger.info(`Checking categories for provider (${prvdr.id}) in bpp/providers[${i}]`)
        let j = 0
        const categories = onSearchCatalog['bpp/providers'][i]['categories']
        const iLen = categories.length
        while (j < iLen) {
          logger.info(`Validating uniqueness for item id in bpp/providers[${i}].items[${j}]...`)
          const category = categories[j]

          if (categoriesId.has(category.id)) {
            const key = `prvdr${i}category${j}`
            errorObj[key] = `duplicate category id: ${category.id} in bpp/providers[${i}]`
          } else {
            categoriesId.add(category.id)
          }

          try {
            category.tags.map((tag: { code: any; list: any[] }) => {
              switch (tag.code) {
                case 'timing':
                  for (const item of tag.list) {
                    switch (item.code) {
                      case 'day_from':
                      case 'day_to':
                        const dayValue = parseInt(item.value)
                        if (isNaN(dayValue) || dayValue < 1 || dayValue > 7 || !/^-?\d+(\.\d+)?$/.test(item.value)) {
                          errorObj.custom_menu_timing_tag = `Invalid value for '${item.code}': ${item.value}`
                        }

                        break
                      case 'time_from':
                      case 'time_to':
                        if (!/^([01]\d|2[0-3])[0-5]\d$/.test(item.value)) {
                          errorObj.time_to = `Invalid time format for '${item.code}': ${item.value}`
                        }

                        break
                      default:
                        errorObj.Tagtiming = `Invalid list.code for 'timing': ${item.code}`
                    }
                  }

                  const dayFromItem = tag.list.find((item: any) => item.code === 'day_from')
                  const dayToItem = tag.list.find((item: any) => item.code === 'day_to')
                  const timeFromItem = tag.list.find((item: any) => item.code === 'time_from')
                  const timeToItem = tag.list.find((item: any) => item.code === 'time_to')

                  if (dayFromItem && dayToItem && timeFromItem && timeToItem) {
                    const dayFrom = parseInt(dayFromItem.value, 10)
                    const dayTo = parseInt(dayToItem.value, 10)
                    const timeFrom = parseInt(timeFromItem.value, 10)
                    const timeTo = parseInt(timeToItem.value, 10)

                    if (dayTo < dayFrom) {
                      errorObj.day_from = "'day_to' must be greater than or equal to 'day_from'"
                    }

                    if (timeTo <= timeFrom) {
                      errorObj.time_from = "'time_to' must be greater than 'time_from'"
                    }
                  }

                  break
                case 'display':
                  for (const item of tag.list) {
                    if (item.code !== 'rank' || !/^-?\d+(\.\d+)?$/.test(item.value)) {
                      errorObj.rank = `Invalid value for 'display': ${item.value}`
                    }
                  }

                  break
                case 'config':
                  const minItem: any = tag.list.find((item: { code: string }) => item.code === 'min')
                  const maxItem: any = tag.list.find((item: { code: string }) => item.code === 'max')
                  const inputItem: any = tag.list.find((item: { code: string }) => item.code === 'input')
                  const seqItem: any = tag.list.find((item: { code: string }) => item.code === 'seq')

                  if (!minItem || !maxItem) {
                    errorObj[
                      `customization_config_${j}`
                    ] = `Both 'min' and 'max' values are required in 'config' at index: ${j}`
                  }

                  if (!/^-?\d+(\.\d+)?$/.test(minItem.value)) {
                    errorObj[
                      `customization_config_min_${j}`
                    ] = `Invalid value for ${minItem.code}: ${minItem.value} at index: ${j}`
                  }

                  if (!/^-?\d+(\.\d+)?$/.test(maxItem.value)) {
                    errorObj[
                      `customization_config_max_${j}`
                    ] = `Invalid value for ${maxItem.code}: ${maxItem.value}at index: ${j}`
                  }

                  if (!/^-?\d+(\.\d+)?$/.test(seqItem.value)) {
                    errorObj[`config_seq_${j}`] = `Invalid value for ${seqItem.code}: ${seqItem.value} at index: ${j}`
                  }

                  const inputEnum = ['select', 'text']
                  if (!inputEnum.includes(inputItem.value)) {
                    errorObj[
                      `config_input_${j}`
                    ] = `Invalid value for 'input': ${inputItem.value}, it should be one of ${inputEnum} at index: ${j}`
                  }

                  break
              }
            })
            logger.info(`Category '${category.descriptor.name}' is valid.`)
          } catch (error: any) {
            logger.error(`Validation error for category '${category.descriptor.name}': ${error.message}`)
          }

          j++
        }
      } catch (error: any) {
        logger.error(`!!Errors while checking categories in bpp/providers[${i}], ${error.stack}`)
      }

      i++
    }
  } catch (error: any) {
    logger.error(`!!Error while checking Providers info in /${constants.RET_ONSEARCH}, ${error.stack}`)
  }

  return Object.keys(errorObj).length > 0 && errorObj
}