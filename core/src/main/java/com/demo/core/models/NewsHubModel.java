/*
 *  Copyright 2025 Adobe Systems Incorporated
 */
package com.demo.core.models;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;
import javax.annotation.PostConstruct;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class NewsHubModel {

    @ValueMapValue
    private String title;

    @ValueMapValue
    @Default(values = "lg")
    private String sectionPadding;

    @ValueMapValue
    @Default(values = "cream")
    private String backgroundColor;

    @ValueMapValue
    private String hexColor;

    @ChildResource
    private List<NewsCard> items;

    @PostConstruct
    protected void init() {
        if (items == null) {
            items = Collections.emptyList();
        } else {
            items = items.stream().filter(NewsCard::isHasContent).collect(Collectors.toList());
        }
    }

    public String getTitle() { return title; }
    public String getSectionPadding() { return sectionPadding; }
    public String getBackgroundColor() { return backgroundColor; }

    public List<NewsCard> getItems() {
        return items == null ? Collections.emptyList() : new ArrayList<>(items);
    }

    public String getBackgroundStyle() {
        if ("other".equals(backgroundColor) && StringUtils.isNotBlank(hexColor)) {
            return "background-color: " + hexColor.trim() + ";";
        }
        return null;
    }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(title) || (items != null && !items.isEmpty());
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class NewsCard {
        @ValueMapValue
        @Default(values = "regular")
        private String size;

        @ValueMapValue
        private String imagePath;

        @ValueMapValue
        private String itemEyebrow;

        @ValueMapValue
        private String itemTitle;

        @ValueMapValue
        private String itemDescription;

        @ValueMapValue
        private String linkUrl;

        public String getSize() { return size; }
        public String getImagePath() { return imagePath; }
        public String getItemEyebrow() { return itemEyebrow; }
        public String getItemTitle() { return itemTitle; }
        public String getItemDescription() { return itemDescription; }
        public String getLinkUrl() { return linkUrl; }

        public boolean isHasContent() {
            return StringUtils.isNotBlank(itemTitle);
        }
    }
}
