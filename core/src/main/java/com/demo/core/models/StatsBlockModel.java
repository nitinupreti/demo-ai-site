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
public class StatsBlockModel {

    @ValueMapValue
    private String titlePrefix;
    @ValueMapValue
    private String title;
    @ValueMapValue
    private String description;

    @ValueMapValue
    @Default(values = "md")
    private String sectionPadding;

    @ValueMapValue
    @Default(values = "grey")
    private String backgroundColor;

    @ValueMapValue
    private String hexColor;

    @ChildResource
    private List<StatItem> items;

    @PostConstruct
    protected void init() {
        if (items == null) {
            items = Collections.emptyList();
        } else {
            items = items.stream().filter(StatItem::isHasContent).collect(Collectors.toList());
        }
    }

    public String getTitlePrefix() { return titlePrefix; }
    public String getTitle() { return title; }
    public String getDescription() { return description; }
    public String getSectionPadding() { return sectionPadding; }
    public String getBackgroundColor() { return backgroundColor; }

    public List<StatItem> getItems() {
        return items == null ? Collections.emptyList() : new ArrayList<>(items);
    }

    public String getBackgroundStyle() {
        if ("other".equals(backgroundColor) && StringUtils.isNotBlank(hexColor)) {
            return "background-color: " + hexColor.trim() + ";";
        }
        return null;
    }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(title)
                || StringUtils.isNotBlank(description)
                || (items != null && !items.isEmpty());
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class StatItem {
        @ValueMapValue
        private String iconPath;
        @ValueMapValue
        private String iconAlt;
        @ValueMapValue
        private String number;
        @ValueMapValue
        private String label;

        public String getIconPath() { return iconPath; }
        public String getIconAlt() { return StringUtils.defaultString(iconAlt); }
        public String getNumber() { return number; }
        public String getLabel() { return label; }

        public boolean isHasContent() {
            return StringUtils.isNotBlank(number);
        }
    }
}
